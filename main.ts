// Tiny stack VM — written from make.fun's ISA.md (tiny-stack-vm-01-run-20261122).
// One program answers a whole set: for each instance it runs program.bin
// against input.bin and writes stdout.bin + exit.txt.
//
// Trap codes (ISA.md "Traps") and machine limits — the details most
// implementations get wrong, so they are written down here, not assumed:
//   0 HALT (exit 0) · 2 stack underflow · 3 stack overflow (>256 values)
//   4 division by zero · 5 unknown opcode · 6 memory address outside 0..255
//   7 call stack overflow (64 return addresses) · 8 RET on an empty call stack
//   9 pc outside the program, or an immediate cut off by the program's end
//   10 step limit (1,000,000 instructions) · 11 output limit (65,536 bytes)
// EXIT (0x53) exits with the low byte of the popped value. A trap keeps the
// output written before it; the trapping instruction itself writes nothing.
// Limits: data stack 256, call stack 64, memory 256 words, output 65,536 B.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per opcode: [immediate length, values popped, values pushed].
const META: { [op: number]: [number, number, number] } = {
  0x00: [0, 0, 0],
  0x01: [1, 0, 1],
  0x02: [4, 0, 1],
  0x03: [0, 1, 0],
  0x04: [0, 1, 2],
  0x05: [0, 2, 2],
  0x06: [0, 2, 3],
  0x07: [0, 3, 3],
  0x10: [0, 2, 1],
  0x11: [0, 2, 1],
  0x12: [0, 2, 1],
  0x13: [0, 2, 1],
  0x14: [0, 2, 1],
  0x15: [0, 2, 1],
  0x16: [0, 2, 1],
  0x17: [0, 1, 1],
  0x18: [0, 2, 1],
  0x19: [0, 2, 1],
  0x1a: [0, 2, 1],
  0x1b: [0, 1, 1],
  0x1c: [0, 2, 1],
  0x1d: [0, 2, 1],
  0x1e: [0, 2, 1],
  0x20: [0, 2, 1],
  0x21: [0, 2, 1],
  0x22: [0, 2, 1],
  0x30: [2, 0, 0],
  0x31: [2, 1, 0],
  0x32: [2, 1, 0],
  0x33: [2, 0, 0],
  0x34: [0, 0, 0],
  0x40: [0, 1, 1],
  0x41: [0, 2, 0],
  0x50: [0, 1, 0],
  0x51: [0, 1, 0],
  0x52: [0, 0, 1],
  0x53: [0, 1, 0],
};

const LIM = -2147483648; // most negative int32

function execute(prog: Uint8Array, input: Uint8Array): { bytes: Uint8Array; code: number } {
  const total = prog.length;
  const st = new Int32Array(256);
  const cs = new Int32Array(64);
  const mem = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, cp = 0, ip = 0, pc = 0, len = 0, steps = 0;
  const end = (code: number) => ({ bytes: out.slice(0, len), code });

  for (;;) {
    if (steps === 1000000) return end(10);
    if (pc < 0 || pc >= total) return end(9);
    const meta = META[prog[pc]];
    if (!meta) return end(5);
    const [imm, pop, push] = meta;
    if (pc + imm >= total) return end(9);
    if (sp < pop) return end(2);
    if (sp - pop + push > 256) return end(3);
    steps++;
    const op = prog[pc];
    const at = pc;
    pc = at + 1 + imm;

    switch (op) {
      case 0x00: return end(0);
      case 0x01: st[sp++] = (prog[at + 1] << 24) >> 24; break;
      case 0x02:
        st[sp++] = prog[at + 1] | (prog[at + 2] << 8) | (prog[at + 3] << 16) | (prog[at + 4] << 24);
        break;
      case 0x03: sp--; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; }
      case 0x06: st[sp] = st[sp - 2]; sp++; break;
      case 0x07: {
        const a = st[sp - 3];
        st[sp - 3] = st[sp - 2];
        st[sp - 2] = st[sp - 1];
        st[sp - 1] = a;
        break;
      }
      case 0x17: st[sp - 1] = (-st[sp - 1]) | 0; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      case 0x16: case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d:
      case 0x1e: case 0x20: case 0x21: case 0x22: {
        const b = st[sp - 1], a = st[sp - 2];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return end(4);
          r = a === LIM && b === -1 ? LIM : (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        st[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const off = ((prog[at + 1] | (prog[at + 2] << 8)) << 16) >> 16;
        let go = op === 0x30;
        if (op !== 0x30) {
          const v = st[--sp];
          go = op === 0x31 ? v === 0 : v !== 0;
        }
        if (go) pc = pc + off;
        break;
      }
      case 0x33:
        if (cp === 64) return end(7);
        cs[cp++] = pc;
        pc = prog[at + 1] | (prog[at + 2] << 8);
        break;
      case 0x34:
        if (cp === 0) return end(8);
        pc = cs[--cp];
        break;
      case 0x40: {
        const addr = st[sp - 1];
        if (addr < 0 || addr > 255) return end(6);
        st[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = st[sp - 1], v = st[sp - 2];
        if (addr < 0 || addr > 255) return end(6);
        sp -= 2;
        mem[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(st[sp - 1]);
        if (len + s.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[len++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (len + 1 > 65536) return end(11);
        out[len++] = st[--sp] & 255;
        break;
      case 0x52: st[sp++] = ip < input.length ? input[ip++] : -1; break;
      case 0x53: return end(st[--sp] & 255);
    }
  }
}

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(IN_DIR).sort()) {
  let input: Uint8Array;
  try {
    input = new Uint8Array(readFileSync(join(IN_DIR, id, 'input.bin')));
  } catch {
    input = new Uint8Array(0);
  }
  const res = execute(new Uint8Array(readFileSync(join(IN_DIR, id, 'program.bin'))), input);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), res.bytes);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), `${res.code}\n`);
}
