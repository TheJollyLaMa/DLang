export function resolveArtwork(catalog, concept, { sceneVersion, viewport = 'desktop' } = {}) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.batches)) {
    return { available: false, state: 'unavailable', reason: 'Artwork catalog is missing or unsupported.' };
  }
  if (viewport !== 'desktop' && viewport !== 'mobile') {
    return { available: false, state: 'unavailable', reason: 'Unsupported artwork viewport.' };
  }
  const eligible = catalog.batches
    .filter(batch => batch?.status === 'approved' && batch.sceneVersion === sceneVersion
      && typeof batch.month === 'string' && typeof batch.batchId === 'string' && Array.isArray(batch.assets))
    .sort((a, b) => b.month.localeCompare(a.month) || b.batchId.localeCompare(a.batchId));
  for (const batch of eligible) {
    const asset = batch.assets.find(entry => {
      const recognition = entry?.review?.recognition;
      const filePath = entry?.files?.[viewport]?.path;
      const visualReview = entry?.review?.visual;
      const languageReview = entry?.review?.language;
      return entry?.concept === concept
        && visualReview?.status === 'approved' && typeof visualReview.reviewer === 'string'
        && typeof visualReview.reviewedAt === 'string'
        && languageReview?.status === 'approved' && typeof languageReview.reviewer === 'string'
        && languageReview.reviewer !== visualReview.reviewer
        && Array.isArray(languageReview.languages) && languageReview.languages.length > 0
        && typeof languageReview.reviewedAt === 'string'
        && Number.isInteger(recognition?.participants) && recognition.participants > 0
        && Number.isInteger(recognition.recognized) && recognition.recognized >= 0
        && recognition.recognized <= recognition.participants
        && Number.isFinite(recognition.threshold) && recognition.threshold > 0
        && recognition.threshold <= 1
        && typeof recognition.method === 'string' && recognition.method.length > 0
        && recognition.recognized / recognition.participants >= recognition.threshold
        && /^artwork\/[a-z0-9][a-z0-9-]{2,63}\/[a-z0-9][a-z0-9-]{2,63}-(desktop|mobile)\.png$/.test(filePath || '')
        && Number.isInteger(entry.artVersion) && entry.artVersion > 0
        && typeof entry.description === 'string' && entry.description.length > 0
        && entry.source?.provider === 'Runway' && typeof entry.source.model === 'string'
        && typeof entry.source.jobId === 'string'
        && entry.source.rights?.status === 'cleared'
        && typeof entry.source.rights.owner === 'string'
        && typeof entry.source.rights.license === 'string';
    });
    if (asset) return { available: true, state: 'approved', batchId: batch.batchId, asset };
  }
  return {
    available: false,
    state: catalog.status === 'unavailable' ? 'unavailable' : 'fallback',
    reason: catalog.status === 'unavailable'
      ? 'No reviewed artwork is published; keep the original scene renderer.'
      : 'No approved artwork matches this concept and scene version; keep the original scene renderer.'
  };
}
