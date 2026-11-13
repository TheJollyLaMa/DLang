// Adapted lifecycle ideas from DecentBusking js/rehearsal.mjs, ac8a9cc
// (Apache-2.0). A separately configured, trusted service must enforce the
// invitation, wallet/origin challenge, quotas, revocation and provider limits.
export function createConversationLiveKit({ sdk, audio, livekitOrigin, onStatus = () => {},
  now = () => Date.now(), events = globalThis, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const trusted = new URL(livekitOrigin);
  if (trusted.protocol !== 'wss:' || trusted.username || trusted.password ||
      trusted.pathname !== '/' || trusted.search || trusted.hash) throw Error('A trusted WSS origin is required.');
  if (!sdk?.Room || !sdk?.RoomEvent || !sdk?.Track || !audio) throw Error('LiveKit client unavailable.');
  let room, local, remote, timer, generation = 0, disposed = false, busy = false;
  const status = text => { if (!disposed) onStatus(text); };
  function stop(message = 'Left private audio.') {
    events?.dispatchEvent?.(new CustomEvent('dlang:private-audio', { detail: { active: false } }));
    generation++; busy = false; clearTimer(timer); timer = null;
    const previous = room; room = null;
    const track = local; local = null;
    try { track?.stop(); } catch {}
    try { remote?.detach(audio); } catch {}
    remote = null;
    try { audio.pause(); audio.srcObject = null; } catch {}
    if (previous) { try { void Promise.resolve(previous.disconnect()).catch(() => {}); } catch {} }
    status(message);
  }
  const walletChange = () => stop('Wallet changed; private audio stopped.');
  const pageHide = () => stop('Private audio stopped.');
  events?.addEventListener?.('dlang:wallet', walletChange);
  events?.addEventListener?.('pagehide', pageHide);
  async function start({ grant, consent, microphone = false } = {}) {
    if (disposed || busy || room) throw Error('Private audio is already active or unavailable.');
    if (consent !== true) throw Error('Consent is required before connecting.');
    let url;
    try { url = new URL(grant?.url); } catch { throw Error('Invalid private audio grant.'); }
    const expiresAt = grant?.expiresAt;
    if (url.protocol !== 'wss:' || url.origin !== trusted.origin || url.username || url.password ||
        url.search || url.hash || typeof grant.token !== 'string' || !grant.token || grant.token.length > 8192 ||
        typeof grant.otherIdentity !== 'string' || !grant.otherIdentity || grant.otherIdentity.length > 256 ||
        grant.participantCap !== 2 || !Number.isSafeInteger(expiresAt) ||
        expiresAt <= now() || expiresAt > now() + 15 * 60_000) throw Error('Invalid private audio grant.');
    busy = true;
    events?.dispatchEvent?.(new CustomEvent('dlang:private-audio', { detail: { active: true } }));
    const current = ++generation;
    const valid = () => current === generation && !disposed && expiresAt > now();
    let next;
    try {
      next = new sdk.Room({ adaptiveStream: false, dynacast: false,
        reconnectPolicy: { nextRetryDelayInMs: () => null } });
    } catch { busy = false; throw Error('Private audio client unavailable.'); }
    room = next;
    const subscribe = (publication, participant) => {
      if (valid() && participant.identity === grant.otherIdentity &&
          publication.kind === sdk.Track.Kind.Audio) publication.setSubscribed(true);
    };
    next.on(sdk.RoomEvent.TrackPublished, subscribe);
    next.on(sdk.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (!valid() || participant.identity !== grant.otherIdentity || track.kind !== sdk.Track.Kind.Audio) return;
      remote?.detach(audio); remote = track; track.attach(audio);
      void Promise.resolve(audio.play()).catch(() => status('Tap play to hear private audio.'));
    });
    next.on(sdk.RoomEvent.TrackUnsubscribed, track => {
      if (track === remote) { track.detach(audio); remote = null; }
    });
    next.on(sdk.RoomEvent.Disconnected, () => {
      if (room === next) stop('Private audio disconnected.');
    });
    timer = setTimer(() => stop('Private audio expired.'), expiresAt - now());
    try {
      await next.connect(url.href, grant.token, { autoSubscribe: false });
      if (!valid()) { await next.disconnect(); return; }
      for (const participant of next.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) subscribe(publication, participant);
      }
      if (microphone) {
        const capture = await sdk.createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
        if (!valid()) { capture.stop(); await next.disconnect(); return; }
        local = capture;
        await next.localParticipant.publishTrack(capture, { source: sdk.Track.Source.Microphone });
        if (!valid()) { capture.stop(); await next.disconnect(); return; }
      }
      await next.startAudio();
      if (!valid()) { await next.disconnect(); return; }
      status(microphone ? 'Private audio connected; microphone on.' : 'Private audio connected; listening.');
    } catch {
      if (valid()) stop('Private audio unavailable; microphone stopped.');
      else { try { await next.disconnect(); } catch {} }
      throw Error('Private audio could not connect.');
    } finally { if (current === generation) busy = false; }
  }
  async function mute() {
    if (!local) return;
    try { await local.mute(); status('Microphone muted.'); }
    catch { stop('Microphone could not be muted; audio stopped.'); }
  }
  function dispose() {
    if (disposed) return;
    stop(); disposed = true;
    events?.removeEventListener?.('dlang:wallet', walletChange);
    events?.removeEventListener?.('pagehide', pageHide);
  }
  return { start, mute, interrupt: mute, stop, dispose };
}
