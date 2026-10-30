// GPX import/export so tracks can move to and from Strava, AllTrails, Gaia, etc.

const xmlEscape = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function hikeToGPX(hike) {
  const segs = (hike.segments || []).map(seg => [
    '    <trkseg>',
    ...seg.map(p => {
      const ele = p[2] != null ? `<ele>${p[2]}</ele>` : '';
      const time = p[3] != null ? `<time>${new Date(p[3]).toISOString()}</time>` : '';
      return `      <trkpt lat="${p[0]}" lon="${p[1]}">${ele}${time}</trkpt>`;
    }),
    '    </trkseg>',
  ].join('\n'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Blaze" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xmlEscape(hike.name)}</name><time>${new Date(hike.startedAt).toISOString()}</time></metadata>
  <trk>
    <name>${xmlEscape(hike.name)}</name>
${segs.join('\n')}
  </trk>
</gpx>
`;
}

export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error("That file doesn't look like valid GPX.");

  const child = (el, name) => el.getElementsByTagName(name)[0]?.textContent?.trim();
  const toPoint = el => {
    const ele = parseFloat(child(el, 'ele'));
    const time = Date.parse(child(el, 'time') ?? '');
    return [
      +(+el.getAttribute('lat')).toFixed(6),
      +(+el.getAttribute('lon')).toFixed(6),
      Number.isFinite(ele) ? ele : null,
      Number.isFinite(time) ? time : null,
      null,
    ];
  };

  let segments = [...doc.getElementsByTagName('trkseg')].map(s => [...s.getElementsByTagName('trkpt')].map(toPoint));
  if (!segments.some(s => s.length)) {
    segments = [...doc.getElementsByTagName('rte')].map(r => [...r.getElementsByTagName('rtept')].map(toPoint));
  }
  segments = segments
    .map(s => s.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])))
    .filter(s => s.length);
  if (!segments.length) throw new Error('No track points found in that GPX file.');

  const trk = doc.getElementsByTagName('trk')[0];
  const name = (trk && child(trk, 'name')) || child(doc, 'name') || '';
  return { name, segments };
}
