export function pilotEligibility(roster, address) {
  const valid = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
  if (!roster || roster.format !== 'dlang-reviewed-pilot-roster' || roster.version !== 1 ||
      roster.authorization !== false || roster.maximumEntrants !== 8 ||
      !Array.isArray(roster.members) || !roster.members.length || roster.members.length > 8 ||
      roster.members.some(row => !valid(row.walletAddress) || typeof row.label !== 'string' || !row.label.trim()) ||
      new Set(roster.members.map(row => row.walletAddress.toLowerCase())).size !== roster.members.length) {
    throw Error('Reviewed pilot roster unavailable or invalid.');
  }
  if (!valid(address)) throw Error('Invalid connected wallet.');
  return { eligible: roster.members.some(row => row.walletAddress.toLowerCase() === address.toLowerCase()), authorization: false };
}
