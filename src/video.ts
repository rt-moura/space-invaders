import { Memory } from "./memory.js";

export class Video {
	private readonly frameBuffer: Uint8Array[];
	private readonly memory: Memory;
	private readonly context: CanvasRenderingContext2D;
	private readonly imageData: ImageData;
	private readonly videoWidth = 256;
	private readonly videoHeight = 224;
	private readonly videoMemoryStart = 0x2400;
	private readonly videoMemoryEnd = 0x3fff;

	constructor(memory: Memory, canvas: HTMLCanvasElement) {
		this.memory = memory;

		const context = canvas.getContext("2d");
		if (!context) throw new Error("Não foi possível obter o contexto 2D do canvas");

		canvas.width = this.videoHeight;
		canvas.height = this.videoWidth;

		this.context = context;
		this.imageData = context.createImageData(canvas.width, canvas.height);
		this.frameBuffer = Array.from({ length: this.videoHeight }, () => new Uint8Array(this.videoWidth));
	}

	private update(): void {
		for (let address = this.videoMemoryStart; address <= this.videoMemoryEnd; address++) {
			const offset = address - this.videoMemoryStart;
			const pixels = this.memory.readByte(address);
			const y = Math.floor(offset / (this.videoWidth / 8));
			const startX = (offset % (this.videoWidth / 8)) * 8;

			for (let bit = 0; bit < 8; bit++) {
				this.frameBuffer[y][startX + bit] = (pixels >> bit) & 1;
			}
		}
	}

	public draw(): void {
		this.update();

		for (let y = 0; y < this.videoHeight; y++) {
			for (let x = 0; x < this.videoWidth; x++) {
				const screenX = y;
				const screenY = this.videoWidth - 1 - x;
				const pixelIndex = (screenY * this.videoHeight + screenX) * 4;
				const color = this.frameBuffer[y][x] === 1 ? 0xff : 0x00;

				this.imageData.data[pixelIndex] = color;
				this.imageData.data[pixelIndex + 1] = color;
				this.imageData.data[pixelIndex + 2] = color;
				this.imageData.data[pixelIndex + 3] = 0xff;
			}
		}

		this.context.putImageData(this.imageData, 0, 0);
	}

	public getFrameBuffer(): readonly Uint8Array[] {
		return this.frameBuffer;
	}
}
