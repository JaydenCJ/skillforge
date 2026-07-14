/** Minimal ANSI color helper honoring NO_COLOR / non-TTY output. */

const ESC = "\u001b";

const enabled =
  process.env["NO_COLOR"] === undefined &&
  process.env["FORCE_COLOR"] !== "0" &&
  (process.env["FORCE_COLOR"] !== undefined || (process.stdout && process.stdout.isTTY === true));

function wrap(open: number, close: number): (s: string) => string {
  return (s: string) => (enabled ? `${ESC}[${open}m${s}${ESC}[${close}m` : s);
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);
