// Recordings from MediaRecorder (Chrome, Firefox, the WebKitGTK of the desktop app) are written as a
// live stream: the WebM file carries neither its length nor an index. Browsers then show no total time,
// and WebKit (GStreamer) guesses a length of a fraction of a second: the playhead stops there while the
// sound goes on, and seeking does nothing. This module measures the length from the blocks in the file
// and writes it into the header (Segment > Info > Duration); a file without any index also gets one
// (Cues at the end, found through a SeekHead at the start), so players can seek in it.
// The WebKitGTK of the desktop app (GStreamer) does not start the recording's clock at 0: its first cluster
// sits at the pipeline's running time, hours into the stream (e.g. 19:43:29). Players then showed that as
// the length (or a total like "34:25:12") and jumped to the end; such files get their times moved to start
// at 0 (cluster timecodes and cue times, rewritten in place).

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

const ID_SEGMENT = 0x18538067;
const ID_SEEKHEAD = 0x114d9b74;
const ID_SEEK = 0x4dbb;
const ID_SEEKPOSITION = 0x53ac;
const ID_INFO = 0x1549a966;
const ID_TIMECODESCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE = 0xe7;
const ID_BLOCKGROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_SIMPLEBLOCK = 0xa3;
const ID_CUES = 0x1c53bb6b;
const ID_CUEPOINT = 0xbb;
const ID_CUETIME = 0xb3;

// Master elements whose children matter; everything else is skipped by its size
const DESCEND = new Set([ID_SEGMENT, ID_SEEKHEAD, ID_SEEK, ID_INFO, ID_CLUSTER, ID_BLOCKGROUP, ID_CUES, ID_CUEPOINT]);

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}

/** An EBML ID (marker bits kept) at pos, or null past the end / when invalid. */
function readId(b: Uint8Array, pos: number): Vint | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || pos + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + b[pos + i];
  return { value, length, unknown: false };
}

/** An EBML size (marker bit removed) at pos; all value bits set means "unknown size". */
function readSize(b: Uint8Array, pos: number): Vint | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  if (pos + length > b.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

/** size as an EBML size of exactly width bytes, or null when it does not fit. */
function encodeSize(size: number, width: number): number[] | null {
  if (size >= 2 ** (7 * width) - 1) return null;
  const out = uintBytes(size, width);
  out[0] |= 0x80 >> (width - 1);
  return out;
}

/** size as the shortest EBML size. */
function sizeBytes(size: number): number[] {
  for (let width = 1; ; width++) {
    const out = encodeSize(size, width);
    if (out) return out;
  }
}

function uintBytes(value: number, width: number): number[] {
  const out: number[] = new Array(width);
  for (let i = width - 1, v = value; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v % 256;
  return out;
}

/** An element with an ID (as bytes) and its data. */
function element(id: number[], data: number[]): number[] {
  return [...id, ...sizeBytes(data.length), ...data];
}

function uintElement(id: number[], value: number): number[] {
  return element(id, uintBytes(value, value < 256 ? 1 : value < 65536 ? 2 : value < 2 ** 32 ? 4 : 8));
}

function readUint(b: Uint8Array, pos: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[pos + i];
  return v;
}

function readFloat(b: Uint8Array, pos: number, len: number): number {
  if (len !== 4 && len !== 8) return NaN;
  const view = new DataView(b.buffer, b.byteOffset + pos, len);
  return len === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

interface UintField {
  value: number;
  pos: number;
  length: number;
}

export interface WebmScan {
  /** Length in the file's timecode units (normally milliseconds), measured from the blocks (from start) */
  measured: number;
  /** Time of the first cluster when the file does not start at 0 (WebKitGTK), else 0: moved to 0 on repair */
  start: number;
  /** Cluster timecodes and cue times as stored (absolute positions) */
  timecodes: UintField[];
  cueTimes: UintField[];
  timecodeScale: number;
  /** Duration stored in the header, if any (timecode units) */
  stored?: { value: number; pos: number; length: number };
  segment?: { sizePos: number; sizeLength: number; size: number; unknown: boolean };
  info?: { sizePos: number; sizeLength: number; dataStart: number; dataEnd: number };
  /** Positions in a SeekHead (relative to the segment's data) */
  seekPositions: UintField[];
  hasSeekHead: boolean;
  hasCues: boolean;
  /** Start of each cluster (absolute) with its time */
  clusters: { pos: number; time: number }[];
  /** Track of the first block */
  track: number;
}

/** Walks a WebM file; null when it is no WebM or cannot be read. */
export function scanWebm(b: Uint8Array): WebmScan | null {
  if (b.length < 4 || EBML_MAGIC.some((v, i) => b[i] !== v)) return null;
  const scan: WebmScan = {
    measured: 0,
    start: 0,
    timecodes: [],
    cueTimes: [],
    timecodeScale: 1_000_000,
    seekPositions: [],
    hasSeekHead: false,
    hasCues: false,
    clusters: [],
    track: 0,
  };
  let clusterTime = 0;
  let last = -1;
  let first = Infinity;
  let frame = 0;
  let pos = 0;
  while (pos < b.length) {
    const id = readId(b, pos);
    if (!id) break;
    const size = readSize(b, pos + id.length);
    if (!size) break;
    const dataStart = pos + id.length + size.length;
    const dataEnd = size.unknown ? b.length : Math.min(b.length, dataStart + size.value);
    if (DESCEND.has(id.value)) {
      if (id.value === ID_SEGMENT && !scan.segment) {
        scan.segment = { sizePos: pos + id.length, sizeLength: size.length, size: size.value, unknown: size.unknown };
      } else if (id.value === ID_INFO && !scan.info) {
        if (size.unknown) return null;
        scan.info = { sizePos: pos + id.length, sizeLength: size.length, dataStart, dataEnd };
      } else if (id.value === ID_SEEKHEAD) {
        scan.hasSeekHead = true;
      } else if (id.value === ID_CLUSTER) {
        scan.clusters.push({ pos, time: 0 });
      } else if (id.value === ID_CUES) {
        scan.hasCues = true;
      }
      pos = dataStart;
      continue;
    }
    switch (id.value) {
      case ID_SEEKPOSITION:
        scan.seekPositions.push({ value: readUint(b, dataStart, dataEnd - dataStart), pos: dataStart, length: dataEnd - dataStart });
        break;
      case ID_CUETIME:
        scan.cueTimes.push({ value: readUint(b, dataStart, dataEnd - dataStart), pos: dataStart, length: dataEnd - dataStart });
        break;
      case ID_TIMECODESCALE:
        scan.timecodeScale = readUint(b, dataStart, dataEnd - dataStart) || 1_000_000;
        break;
      case ID_DURATION:
        scan.stored = { value: readFloat(b, dataStart, dataEnd - dataStart), pos: dataStart, length: dataEnd - dataStart };
        break;
      case ID_TIMECODE:
        clusterTime = readUint(b, dataStart, dataEnd - dataStart);
        scan.timecodes.push({ value: clusterTime, pos: dataStart, length: dataEnd - dataStart });
        if (scan.clusters.length) scan.clusters[scan.clusters.length - 1].time = clusterTime;
        break;
      case ID_SIMPLEBLOCK:
      case ID_BLOCK: {
        const track = readSize(b, dataStart);
        if (!track || dataStart + track.length + 2 > b.length) break;
        if (!scan.track) scan.track = track.value;
        const rel = new DataView(b.buffer, b.byteOffset + dataStart + track.length, 2).getInt16(0);
        const time = clusterTime + rel;
        // One frame after the last block's start (the gap between the last two, at most 120 ms)
        if (last >= 0 && time > last) frame = Math.min(120_000_000 / scan.timecodeScale, time - last);
        if (time > last) last = time;
        if (time < first) first = time;
        break;
      }
    }
    if (size.unknown) break; // unknown size of an element we do not walk into: cannot go on
    pos = dataEnd;
  }
  if (last < 0) return null;
  // Starts later than 0: every cluster and block lies at or after the first cluster's time, so all of them
  // can be moved back by it (a block before it would end up at a negative time: then nothing moves)
  const start = scan.timecodes.reduce((min, t) => Math.min(min, t.value), Infinity);
  if (Number.isFinite(start) && start > 0 && first >= start) scan.start = start;
  scan.measured = last + frame - scan.start;
  return scan;
}

/** Length of a WebM file in seconds, as stored or measured; null when it is no readable WebM. */
export function webmDurationSeconds(b: Uint8Array): number | null {
  const scan = scanWebm(b);
  if (!scan) return null;
  // A stored length of a file that does not start at 0 is not trusted (an earlier repair wrote the time of
  // the last block as the length)
  const units = hasDuration(scan) && !scan.start ? scan.stored!.value : scan.measured;
  return (units * scan.timecodeScale) / 1e9;
}

function hasDuration(scan: WebmScan): boolean {
  return !!scan.stored && Number.isFinite(scan.stored.value) && scan.stored.value > 0;
}

/**
 * The WebM file with its measured length in the header (and an index when it has none), its times moved to
 * start at 0, or null when nothing needs to change (it has a length already and starts at 0, is no WebM,
 * or cannot be changed safely).
 */
export function repairWebm(b: Uint8Array): Uint8Array | null {
  const scan = scanWebm(b);
  if (!scan || !scan.info || !scan.segment || scan.measured <= 0) return null;
  const { stored, info, segment, start } = scan;
  if (hasDuration(scan) && !start) return null;
  // Cues point into the file: with them present nothing may move, only a placeholder be filled in (or
  // the times be rewritten in place)
  const inPlace = scan.hasCues && !stored;
  if (inPlace && !start) return null;
  if (stored && stored.length !== 4 && stored.length !== 8) return null;
  const segmentData = segment.sizePos + segment.sizeLength;

  // Duration into Info: a placeholder (0) is overwritten in place, else an element is added at its end
  let durationEl: number[] = [];
  let infoSize: number[] = Array.from(b.subarray(info.sizePos, info.dataStart));
  if (!stored && !inPlace) {
    const value = new Uint8Array(8);
    new DataView(value.buffer).setFloat64(0, scan.measured);
    durationEl = [0x44, 0x89, 0x88, ...value];
    const size = info.dataEnd - info.dataStart + durationEl.length;
    let width = info.sizeLength;
    let bytes = encodeSize(size, width);
    while (!bytes && width < 8) bytes = encodeSize(size, ++width);
    if (!bytes) return null;
    infoSize = bytes;
  }
  const infoAdded = durationEl.length + infoSize.length - info.sizeLength;

  // A file without index (MediaRecorder) gets one: a SeekHead at the start of the segment (fixed size, its
  // position written as 8 bytes) points to Cues at the end, one entry per cluster
  const addIndex = !scan.hasSeekHead && !scan.hasCues && scan.clusters.length > 0 && scan.track > 0;
  const seekHeadSize = addIndex ? 26 : 0;
  const shift = (abs: number) => abs + seekHeadSize + (abs >= info.dataEnd ? infoAdded : 0);
  let cues: number[] = [];
  if (addIndex) {
    for (const c of scan.clusters) {
      const positions = element([0xb7], [...uintElement([0xf7], scan.track), ...uintElement([0xf1], shift(c.pos) - segmentData)]);
      cues.push(...element([0xbb], [...uintElement([0xb3], c.time - start), ...positions]));
    }
    cues = element([0x1c, 0x53, 0xbb, 0x6b], cues);
  }
  const cuesPos = shift(b.length) - segmentData;
  const seekHead = addIndex
    ? element([0x11, 0x4d, 0x9b, 0x74], element([0x4d, 0xbb], [...element([0x53, 0xab], [0x1c, 0x53, 0xbb, 0x6b]), ...element([0x53, 0xac], uintBytes(cuesPos, 8))]))
    : [];

  const added = seekHead.length + infoAdded + cues.length;
  const out = new Uint8Array(b.length + added);
  let pos = 0;
  const put = (part: ArrayLike<number>) => {
    out.set(part, pos);
    pos += part.length;
  };
  put(b.subarray(0, segmentData));
  if (!segment.unknown) {
    const segSize = encodeSize(segment.size + added, segment.sizeLength);
    if (!segSize) return null;
    out.set(segSize, segment.sizePos);
  }
  put(seekHead);
  put(b.subarray(segmentData, info.sizePos));
  put(infoSize);
  put(b.subarray(info.dataStart, info.dataEnd));
  put(durationEl);
  put(b.subarray(info.dataEnd));
  put(cues);

  if (stored) {
    const view = new DataView(out.buffer, shift(stored.pos), stored.length);
    if (stored.length === 4) view.setFloat32(0, scan.measured);
    else view.setFloat64(0, scan.measured);
  }
  // Times from 0: the same number of bytes each, so nothing moves
  if (start) {
    for (const t of [...scan.timecodes, ...scan.cueTimes]) {
      if (t.value >= start) out.set(uintBytes(t.value - start, t.length), shift(t.pos));
    }
  }
  // Positions in an existing SeekHead move along with what they point to
  for (const seek of scan.seekPositions) {
    const value = shift(segmentData + seek.value) - segmentData;
    if (value >= 2 ** (8 * seek.length)) return null;
    out.set(uintBytes(value, seek.length), shift(seek.pos));
  }
  return out;
}

/** The recording with its length (and an index) in the file; the blob itself when nothing needs to change. */
export async function repairWebmBlob(blob: Blob): Promise<Blob> {
  try {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (EBML_MAGIC.some((v, i) => head[i] !== v)) return blob;
    const fixed = repairWebm(new Uint8Array(await blob.arrayBuffer()));
    return fixed ? new Blob([fixed as Uint8Array<ArrayBuffer>], { type: blob.type }) : blob;
  } catch {
    return blob;
  }
}
