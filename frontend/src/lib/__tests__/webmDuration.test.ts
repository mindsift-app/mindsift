import { describe, it, expect } from 'vitest';
import { repairWebm, repairWebmBlob, scanWebm, webmDurationSeconds } from '../webmDuration';

// A small WebM as MediaRecorder writes it: EBML header, Segment and Clusters of unknown size, no Duration,
// no SeekHead, no Cues. Blocks every 20 ms on track 1.
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

function el(id: number[], data: number[]): number[] {
  if (data.length > 126) throw new Error('test helper: data too long');
  return [...id, 0x80 | data.length, ...data];
}

function block(rel: number): number[] {
  return el([0xa3], [0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80, 0xaa, 0xbb]);
}

function cluster(time: number, rels: number[]): number[] {
  return [0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...el([0xe7], [(time >> 8) & 0xff, time & 0xff]), ...rels.flatMap(block)];
}

function info(extra: number[] = []): number[] {
  return el([0x15, 0x49, 0xa9, 0x66], [...el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...extra]);
}

function recording(options: { info?: number[]; before?: number[] } = {}): Uint8Array {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d]));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], [0x01])));
  return new Uint8Array([
    ...header,
    0x18, 0x53, 0x80, 0x67, ...UNKNOWN,
    ...(options.before ?? []),
    ...(options.info ?? info()),
    ...tracks,
    ...cluster(0, [0, 20, 40]),
    ...cluster(1000, [0, 20, 40, 60]),
  ]);
}

function idAt(b: Uint8Array, pos: number): string {
  return Array.from(b.subarray(pos, pos + 4), (x) => x.toString(16).padStart(2, '0')).join('');
}

describe('webmDuration', () => {
  it('measures the length of a recording from its blocks (last block plus one frame)', () => {
    const scan = scanWebm(recording())!;
    expect(scan.stored).toBeUndefined();
    expect(scan.measured).toBe(1080);
    expect(scan.clusters.map((c) => c.time)).toEqual([0, 1000]);
    expect(webmDurationSeconds(recording())).toBe(1.08);
  });

  it('writes the length into the header and adds an index that points to the clusters', () => {
    const fixed = repairWebm(recording())!;
    const scan = scanWebm(fixed)!;
    expect(scan.stored?.value).toBe(1080);
    expect(webmDurationSeconds(fixed)).toBe(1.08);
    expect(scan.hasCues).toBe(true);

    const segmentData = scan.segment!.sizePos + scan.segment!.sizeLength;
    // The SeekHead points to the Cues
    expect(scan.seekPositions).toHaveLength(1);
    expect(idAt(fixed, segmentData + scan.seekPositions[0].value)).toBe('1c53bb6b');
    // Every cue points to the start of its cluster
    const cuePositions: number[] = [];
    for (let i = 0; i < fixed.length - 1; i++) {
      if (fixed[i] === 0xf1 && fixed[i + 1] === 0x81) cuePositions.push(fixed[i + 2]);
    }
    expect(cuePositions.map((p) => segmentData + p)).toEqual(scan.clusters.map((c) => c.pos));
    for (const c of scan.clusters) expect(idAt(fixed, c.pos)).toBe('1f43b675');
    // The sound itself is unchanged
    expect(scan.measured).toBe(1080);
  });

  it('fills in a placeholder length of 0 in place', () => {
    const zero = el([0x44, 0x89], [0, 0, 0, 0, 0, 0, 0, 0]);
    const original = recording({ info: info(zero) });
    const fixed = repairWebm(original)!;
    expect(webmDurationSeconds(fixed)).toBe(1.08);
    expect(scanWebm(fixed)!.stored?.length).toBe(8);
  });

  it('moves the positions of an existing SeekHead along and adds no second index', () => {
    // SeekHead with one entry pointing to Tracks (right after Info)
    const infoBytes = info();
    const seekHeadSize = 4 + 1 + (2 + 1 + (7 + 4)); // 1 byte position
    const tracksPos = seekHeadSize + infoBytes.length;
    const seek = el([0x4d, 0xbb], [...el([0x53, 0xab], [0x16, 0x54, 0xae, 0x6b]), ...el([0x53, 0xac], [tracksPos])]);
    const seekHead = el([0x11, 0x4d, 0x9b, 0x74], seek);
    expect(seekHead.length).toBe(seekHeadSize);
    const fixed = repairWebm(recording({ before: seekHead, info: infoBytes }))!;
    const scan = scanWebm(fixed)!;
    expect(scan.hasCues).toBe(false);
    expect(scan.stored?.value).toBe(1080);
    const segmentData = scan.segment!.sizePos + scan.segment!.sizeLength;
    expect(idAt(fixed, segmentData + scan.seekPositions[0].value)).toBe('1654ae6b');
  });

  it('leaves files alone that know their length or are no WebM', () => {
    const fixed = repairWebm(recording())!;
    expect(repairWebm(fixed)).toBeNull();
    expect(repairWebm(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0]))).toBeNull();
    expect(scanWebm(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBeNull();
  });

  it('moves a recording of WebKitGTK that starts hours in to 0 (length, cluster times, cues)', () => {
    // GStreamer's running time as first cluster time: 4 bytes per timecode, like WebKitGTK writes them
    const late = (time: number, rels: number[]) => [
      0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN,
      ...el([0xe7], [(time >>> 24) & 0xff, (time >> 16) & 0xff, (time >> 8) & 0xff, time & 0xff]),
      ...rels.flatMap(block),
    ];
    const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d]));
    const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], [0x01])));
    const start = 71_009_806; // 19:43:29
    const original = new Uint8Array([
      ...header, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN, ...info(), ...tracks,
      ...late(start, [0, 20, 40]), ...late(start + 1000, [0, 20, 40, 60]),
    ]);
    const scan = scanWebm(original)!;
    expect(scan.start).toBe(start);
    expect(scan.measured).toBe(1080);
    expect(webmDurationSeconds(original)).toBe(1.08);

    const fixed = repairWebm(original)!;
    const after = scanWebm(fixed)!;
    expect(after.start).toBe(0);
    expect(after.stored?.value).toBe(1080);
    expect(after.clusters.map((c) => c.time)).toEqual([0, 1000]);
    expect(after.timecodes.map((t) => t.length)).toEqual([4, 4]); // rewritten in place
    expect(after.cueTimes.map((t) => t.value)).toEqual([0, 1000]);
    expect(repairWebm(fixed)).toBeNull();
  });

  it('corrects a recording that an earlier repair gave the wrong length (times still hours in)', () => {
    // As the previous version left WebKitGTK's files: Duration = time of the last block, Cues with those times
    const start = 71_009_806;
    const late = (time: number, rels: number[]) => [
      0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN,
      ...el([0xe7], [(time >>> 24) & 0xff, (time >> 16) & 0xff, (time >> 8) & 0xff, time & 0xff]),
      ...rels.flatMap(block),
    ];
    const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d]));
    const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], [0x01])));
    const wrong = new Uint8Array(8);
    new DataView(wrong.buffer).setFloat64(0, start + 1080);
    const original = new Uint8Array([
      ...header, 0x18, 0x53, 0x80, 0x67, ...UNKNOWN,
      ...info(el([0x44, 0x89], Array.from(wrong))), ...tracks,
      ...late(start, [0, 20, 40]), ...late(start + 1000, [0, 20, 40, 60]),
      ...el([0x1c, 0x53, 0xbb, 0x6b], el([0xbb], [...el([0xb3], [(start >>> 24) & 0xff, (start >> 16) & 0xff, (start >> 8) & 0xff, start & 0xff]), ...el([0xb7], el([0xf7], [1]))])),
    ]);
    expect(webmDurationSeconds(original)).toBe(1.08);
    const fixed = repairWebm(original)!;
    expect(fixed.length).toBe(original.length);
    const after = scanWebm(fixed)!;
    expect(after.stored?.value).toBe(1080);
    expect(after.clusters.map((c) => c.time)).toEqual([0, 1000]);
    expect(after.cueTimes.map((t) => t.value)).toEqual([0]);
  });

  it('repairs a recording as Blob and hands other files back unchanged', async () => {
    const blob = new Blob([recording() as Uint8Array<ArrayBuffer>], { type: 'audio/webm;codecs=opus' });
    const fixed = await repairWebmBlob(blob);
    expect(fixed).not.toBe(blob);
    expect(fixed.type).toBe('audio/webm;codecs=opus');
    expect(webmDurationSeconds(new Uint8Array(await fixed.arrayBuffer()))).toBe(1.08);

    const mp4 = new Blob(['....ftypM4A '], { type: 'audio/mp4' });
    expect(await repairWebmBlob(mp4)).toBe(mp4);
  });
});
