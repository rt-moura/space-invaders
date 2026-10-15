import { CPU } from "./cpu.js";
import { Memory } from "./memory.js";
import { Video } from "./video.js";
import { IO } from "./io.js";
import { Control } from "./control.js";
import { Audio } from "./audio.js";

const romFiles = ["invaders.h", "invaders.g", "invaders.f", "invaders.e"] as const;

class SpaceInvaders {
	private readonly memory: Memory;
	private readonly video: Video;
	private readonly cpu: CPU;
	private readonly io: IO;

	constructor() {
		const canvas = document.querySelector<HTMLCanvasElement>("#screen");
		const control = new Control();
		const audio = new Audio();

		if (!canvas) throw new Error('Elemento canvas "#screen" não encontrado');

		this.memory = new Memory();
		this.io = new IO(control, audio);
		this.video = new Video(this.memory, canvas);
		this.cpu = new CPU(this.memory, this.io);
	}

	async loadRom(selectedFiles: FileList): Promise<void> {
		const filesByName = new Map(
			Array.from(selectedFiles, (file) => [file.name.toLowerCase(), file] as const),
		);

		if (selectedFiles.length !== romFiles.length) {
			throw new Error("Selecione os quatro arquivos da ROM de uma vez.");
		}

		const missingFiles = romFiles.filter((fileName) => !filesByName.has(fileName));
		if (missingFiles.length > 0) {
			throw new Error(`Arquivos não encontrados: ${missingFiles.join(", ")}.`);
		}

		let startAddress = 0;

		for (const fileName of romFiles) {
			const file = filesByName.get(fileName);
			if (!file) throw new Error(`Arquivo ${fileName} não encontrado.`);

			const data = new Uint8Array(await file.arrayBuffer());
			this.memory.load(data, startAddress);
			startAddress += data.length;
		}
	}

	run(): void {
		const halfCycle = 16_640;

		let lastTime = 0;
		let accumulator = 0;
		const frameTime = 1000 / 60;
		const maxDelta = 100;

		const frame = (time: number) => {
			if (lastTime === 0) lastTime = time;
			accumulator += Math.min(time - lastTime, maxDelta);
			lastTime = time;

			while (accumulator >= frameTime) {
				this.cpu.run(halfCycle);
				this.cpu.interrupt(0xcf); // RST 1

				this.cpu.run(halfCycle);
				this.cpu.interrupt(0xd7); // RST 2

				this.video.draw();
				accumulator -= frameTime;
			}

			requestAnimationFrame(frame);
		};

		requestAnimationFrame(frame);
	}
}

const spaceInvaders = new SpaceInvaders();
const loadButton = document.querySelector<HTMLButtonElement>("#load-rom");
const romInput = document.querySelector<HTMLInputElement>("#rom-files");
const status = document.querySelector<HTMLElement>("#status");

if (!loadButton || !romInput || !status) {
	throw new Error("Elementos de carregamento da ROM não encontrados.");
}

loadButton.addEventListener("click", () => romInput.click());
romInput.addEventListener("change", async () => {
	if (!romInput.files?.length) return;

	loadButton.disabled = true;
	status.textContent = "Carregando ROM...";

	try {
		await spaceInvaders.loadRom(romInput.files);
		status.textContent = "ROM carregada. O jogo começou.";
		loadButton.textContent = "ROM carregada";
		spaceInvaders.run();
	} catch (error) {
		status.textContent = error instanceof Error ? error.message : "Falha ao carregar a ROM.";
		loadButton.disabled = false;
	} finally {
		romInput.value = "";
	}
});
