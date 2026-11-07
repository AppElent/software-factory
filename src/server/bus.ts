/** Tells open pages which queries changed. Bursts within 250ms arrive as one event. */
export class Bus {
	private readonly listeners = new Set<(keys: string[]) => void>();
	private pending = new Set<string>();
	private timer: NodeJS.Timeout | null = null;

	publish = (keys: string[]) => {
		for (const k of keys) this.pending.add(k);
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			const batch = [...this.pending];
			this.pending = new Set();
			for (const l of this.listeners) l(batch);
		}, 250);
		this.timer.unref();
	};

	subscribe(listener: (keys: string[]) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
