// Order keys sort siblings (ties broken by block ID). Port of internal/collab/orderkey.go; both sides must
// produce identical keys, see orderKey.test.ts for shared test vectors.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SMALLEST_INTEGER = 'A00000000000000000000000000';

function digitIndex(c: string): number {
  return DIGITS.indexOf(c);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  return 0;
}

function integerPart(key: string): string | null {
  if (!key) return null;
  const n = integerLength(key[0]);
  if (n === 0 || n > key.length) return null;
  return key.slice(0, n);
}

export function validOrderKey(k: string): boolean {
  if (!k || k.length > 256 || k === SMALLEST_INTEGER) return false;
  const ip = integerPart(k);
  if (ip === null) return false;
  for (let i = 1; i < k.length; i++) {
    if (digitIndex(k[i]) < 0) return false;
  }
  const frac = k.slice(ip.length);
  return frac === '' || frac[frac.length - 1] !== '0';
}

function incrementInteger(x: string): string | null {
  const head = x[0];
  const digs = x.slice(1).split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = digitIndex(digs[i]) + 1;
    if (d === DIGITS.length) {
      digs[i] = '0';
    } else {
      digs[i] = DIGITS[d];
      carry = false;
    }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push('0');
  else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x: string): string | null {
  const head = x[0];
  const digs = x.slice(1).split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = digitIndex(digs[i]) - 1;
    if (d === -1) {
      digs[i] = 'z';
    } else {
      digs[i] = DIGITS[d];
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return 'Z' + DIGITS[DIGITS.length - 1];
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push('z');
  else digs.pop();
  return h + digs.join('');
}

function midpoint(a: string, b: string): string {
  if (b !== '') {
    let n = 0;
    while (n < b.length) {
      const ca = n < a.length ? a[n] : '0';
      if (ca !== b[n]) break;
      n++;
    }
    if (n > 0) return b.slice(0, n) + midpoint(n < a.length ? a.slice(n) : '', b.slice(n));
  }
  const da = a !== '' ? digitIndex(a[0]) : 0;
  const db = b !== '' ? digitIndex(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.floor((da + db) / 2)];
  if (b !== '' && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.length > 1 ? a.slice(1) : '', '');
}

/** Returns a key strictly between a and b; '' means open end. Throws on an invalid range. */
export function keyBetween(a: string, b: string): string {
  if ((a !== '' && !validOrderKey(a)) || (b !== '' && !validOrderKey(b)) || (a !== '' && b !== '' && a >= b)) {
    throw new Error(`invalid order key range ${a}..${b}`);
  }
  if (a === '' && b === '') return 'a0';
  if (a === '') {
    const ib = integerPart(b)!;
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error('order key range exhausted');
    return res;
  }
  if (b === '') {
    const ia = integerPart(a)!;
    const i = incrementInteger(ia);
    return i !== null ? i : ia + midpoint(a.slice(ia.length), '');
  }
  const ia = integerPart(a)!;
  const ib = integerPart(b)!;
  if (ia === ib) return ia + midpoint(a.slice(ia.length), b.slice(ib.length));
  const i = incrementInteger(ia);
  if (i === null) throw new Error('order key range exhausted');
  return i < b ? i : ia + midpoint(a.slice(ia.length), '');
}

/** Returns n increasing keys between a and b, spread out so bulk inserts stay short. */
export function keysBetween(a: string, b: string, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b === '') {
    const out: string[] = [];
    let prev = a;
    for (let i = 0; i < n; i++) {
      prev = keyBetween(prev, '');
      out.push(prev);
    }
    return out;
  }
  if (a === '') {
    const out: string[] = new Array(n);
    let next = b;
    for (let i = n - 1; i >= 0; i--) {
      next = keyBetween('', next);
      out[i] = next;
    }
    return out;
  }
  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}
