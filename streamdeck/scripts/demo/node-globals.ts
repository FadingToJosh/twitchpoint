/**
 * The few Node globals plugin code touches, for the web demo build only.
 * Injected by scripts/demo/build.mjs; only what the plugins actually call is implemented.
 */

class DemoBuffer {
	constructor(private bytes: Uint8Array) {}

	static from(data: string | ArrayBuffer | Uint8Array, encoding?: string): DemoBuffer {
		if (typeof data === "string") {
			if (encoding === "base64") return new DemoBuffer(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
			return new DemoBuffer(new TextEncoder().encode(data));
		}
		return new DemoBuffer(data instanceof Uint8Array ? data : new Uint8Array(data));
	}

	toString(encoding = "utf8"): string {
		if (encoding === "base64") {
			let s = "";
			for (let i = 0; i < this.bytes.length; i += 0x8000) s += String.fromCharCode(...this.bytes.subarray(i, i + 0x8000));
			return btoa(s);
		}
		return new TextDecoder().decode(this.bytes);
	}
}

export { DemoBuffer as Buffer };
export const process = { env: {} as Record<string, string | undefined>, platform: "win32" };
