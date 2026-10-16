import { CPU, type InstructionTrace } from "./cpu.js";
import { Memory } from "./memory.js";
import { Video } from "./video.js";
import { IO } from "./io.js";
import { Control } from "./control.js";
import { Audio } from "./audio.js";

const romFileNames = ["invaders.h", "invaders.g", "invaders.f", "invaders.e"] as const;
const byteRegisters = ["a", "b", "c", "d", "e", "h", "l"] as const;
const wordRegisters = ["bc", "de", "hl", "psw", "pc", "sp"] as const;
const flagNames = ["sign", "zero", "auxiliaryCarry", "parity", "carry"] as const;

type EmulatorSnapshot = {
	cpu: ReturnType<CPU["getState"]>;
	nextInstruction: InstructionTrace | null;
	instructionHistory: readonly InstructionTrace[];
	paused: boolean;
	romLoaded: boolean;
};

class SpaceInvaders {
	private readonly memory = new Memory();
	private readonly cpu: CPU;
	private readonly video: Video;
	private readonly instructionHistory: InstructionTrace[] = [];
	private updateListener: ((snapshot: EmulatorSnapshot) => void) | null = null;
	private romLoaded = false;
	private started = false;
	private paused = false;
	private lastTime = 0;
	private accumulator = 0;
	private readonly halfCycle = 16_640;
	private readonly frameTime = 1000 / 60;
	private readonly maxDelta = 100;

	private readonly frame = (time: number): void => {
		if (this.paused) {
			this.lastTime = time;
			this.accumulator = 0;
		} else {
			if (this.lastTime === 0) this.lastTime = time;
			this.accumulator += Math.min(time - this.lastTime, this.maxDelta);
			this.lastTime = time;

			while (this.accumulator >= this.frameTime) {
				this.cpu.run(this.halfCycle);
				this.cpu.interrupt(0xcf); // RST 1
				this.cpu.run(this.halfCycle);
				this.cpu.interrupt(0xd7); // RST 2

				this.video.draw();
				this.publish();
				this.accumulator -= this.frameTime;
			}
		}

		requestAnimationFrame(this.frame);
	};

	constructor(canvas: HTMLCanvasElement) {
		this.video = new Video(this.memory, canvas);
		this.cpu = new CPU(this.memory, new IO(new Control(), new Audio()));
		this.cpu.watchInstructions((instruction) => {
			this.instructionHistory.unshift(instruction);
			if (this.instructionHistory.length > 100) this.instructionHistory.pop();
		});
	}

	subscribe(listener: (snapshot: EmulatorSnapshot) => void): void {
		this.updateListener = listener;
		if (this.romLoaded) this.publish();
	}

	loadRom(roms: readonly Uint8Array[]): void {
		let startAddress = 0;
		for (const rom of roms) {
			this.memory.load(rom, startAddress);
			startAddress += rom.length;
		}

		this.romLoaded = true;
		this.publish();
	}

	start(): void {
		if (!this.romLoaded || this.started) return;

		this.started = true;
		this.paused = false;
		this.publish();
		requestAnimationFrame(this.frame);
	}

	togglePause(): void {
		if (!this.started) return;

		this.paused = !this.paused;
		this.lastTime = 0;
		this.accumulator = 0;
		this.publish();
	}

	stepInstruction(): void {
		if (!this.started || !this.paused || this.cpu.getState().halted) return;

		this.cpu.step();
		this.video.draw();
		this.publish();
	}

	private publish(): void {
		if (!this.updateListener) return;

		this.updateListener({
			cpu: this.cpu.getState(),
			nextInstruction: this.romLoaded ? this.cpu.getNextInstruction() : null,
			instructionHistory: this.instructionHistory.slice(),
			paused: this.paused,
			romLoaded: this.romLoaded,
		});
	}
}

class DebuggerView {
	private readonly instructionList = requireElement<HTMLOListElement>("#instruction-list");
	private readonly cpuStatus = requireElement<HTMLElement>("#cpu-status");
	private readonly registerFields = new Map<string, HTMLElement>();
	private readonly flagFields = new Map<string, HTMLElement>();

	constructor() {
		for (const field of document.querySelectorAll<HTMLElement>("[data-register]")) {
			if (field.dataset.register) this.registerFields.set(field.dataset.register, field);
		}
		for (const field of document.querySelectorAll<HTMLElement>("[data-flag]")) {
			if (field.dataset.flag) this.flagFields.set(field.dataset.flag, field);
		}
	}

	render(snapshot: EmulatorSnapshot): void {
		const state = snapshot.cpu;
		const registers = state.registers;

		for (const name of byteRegisters) {
			const field = this.registerFields.get(name);
			if (field) field.textContent = registers[name].toString(16).padStart(2, "0").toUpperCase();
		}
		for (const name of wordRegisters) {
			const field = this.registerFields.get(name);
			if (field) field.textContent = registers[name].toString(16).padStart(4, "0").toUpperCase();
		}
		for (const name of flagNames) {
			const field = this.flagFields.get(name);
			if (field) field.textContent = registers.flags[name] ? "1" : "0";
		}

		this.cpuStatus.textContent = [
			snapshot.paused ? "PAUSED" : "RUNNING",
			state.halted ? "CPU HALTED" : "CPU ACTIVE",
			"INT " + (state.interruptsEnabled ? "ON" : "OFF"),
			"CYCLES " + state.cycles,
		].join("  |  ");

		const fragment = document.createDocumentFragment();
		if (snapshot.nextInstruction) {
			fragment.append(this.createInstructionRow(snapshot.nextInstruction, true));
		} else {
			const halted = document.createElement("li");
			halted.className = "instruction-row instruction-current";
			halted.textContent = "CPU halted; waiting for an interrupt";
			fragment.append(halted);
		}

		for (const instruction of snapshot.instructionHistory) {
			fragment.append(this.createInstructionRow(instruction, false));
		}
		this.instructionList.replaceChildren(fragment);
	}

	private createInstructionRow(instruction: InstructionTrace, current: boolean): HTMLLIElement {
		const row = document.createElement("li");
		row.className = current ? "instruction-row instruction-current" : "instruction-row";
		row.setAttribute("aria-label", current ? "Current instruction" : "Executed instruction");

		const address = document.createElement("span");
		address.className = "instruction-address";
		address.textContent = instruction.address === null
			? "----"
			: instruction.address.toString(16).padStart(4, "0").toUpperCase();

		const opcode = document.createElement("code");
		opcode.className = "instruction-opcode";
		opcode.textContent = instruction.data.opcode.toString(16).padStart(2, "0").toUpperCase();

		const bytes = document.createElement("code");
		bytes.className = "instruction-bytes";
		bytes.textContent = instruction.bytes
			.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
			.join(" ");

		const length = document.createElement("span");
		length.className = "instruction-length";
		length.textContent = instruction.data.length.toString();

		const duration = document.createElement("span");
		duration.className = "instruction-duration";
		duration.textContent = instruction.data.duration.toString();

		const mnemonic = document.createElement("span");
		mnemonic.className = "instruction-mnemonic";
		mnemonic.textContent = instruction.data.mnemonic;

		row.append(address, opcode, bytes, length, duration, mnemonic);
		return row;
	}
}

class EmulatorUI {
	private readonly loadButton = requireElement<HTMLButtonElement>("#load-rom");
	private readonly romInput = requireElement<HTMLInputElement>("#rom-files");
	private readonly status = requireElement<HTMLElement>("#status");
	private readonly pauseButton = requireElement<HTMLButtonElement>("#pause-emulation");
	private readonly stepButton = requireElement<HTMLButtonElement>("#next-instruction");

	constructor(
		private readonly emulator: SpaceInvaders,
		debuggerView: DebuggerView,
	) {
		this.emulator.subscribe((snapshot) => {
			debuggerView.render(snapshot);
			this.updateControls(snapshot);
		});

		this.loadButton.addEventListener("click", () => this.romInput.click());
		this.pauseButton.addEventListener("click", () => this.emulator.togglePause());
		this.stepButton.addEventListener("click", () => this.emulator.stepInstruction());
		this.romInput.addEventListener("change", () => void this.loadSelectedRomFiles());
	}

	private async loadSelectedRomFiles(): Promise<void> {
		const selectedFiles = Array.from(this.romInput.files ?? []);
		if (selectedFiles.length === 0) return;

		this.loadButton.disabled = true;
		this.status.textContent = "Loading ROM...";

		try {
		const filesByName = new Map<string, File>(
			selectedFiles.map((file) => [file.name.toLowerCase(), file]),
		);
			if (selectedFiles.length !== romFileNames.length) {
				throw new Error("Select all four ROM files at once.");
			}

			const missingFiles = romFileNames.filter((fileName) => !filesByName.has(fileName));
			if (missingFiles.length > 0) {
				throw new Error("Missing ROM files: " + missingFiles.join(", ") + ".");
			}

			const roms = await Promise.all(
				romFileNames.map(async (fileName) => {
					const file = filesByName.get(fileName);
					if (!file) throw new Error("ROM file " + fileName + " was not found.");
					return new Uint8Array(await file.arrayBuffer());
				}),
			);

			this.emulator.loadRom(roms);
			this.loadButton.textContent = "ROM loaded";
			this.status.textContent = "ROM loaded. The game has started.";
			this.emulator.start();
		} catch (error) {
			this.status.textContent = error instanceof Error ? error.message : "Failed to load the ROM.";
			this.loadButton.disabled = false;
		} finally {
			this.romInput.value = "";
		}
	}

	private updateControls(snapshot: EmulatorSnapshot): void {
		this.loadButton.disabled = snapshot.romLoaded;
		if (snapshot.romLoaded) this.loadButton.textContent = "ROM loaded";

		this.pauseButton.disabled = !snapshot.romLoaded;
		this.pauseButton.textContent = snapshot.paused ? "Play" : "Pause";
		this.stepButton.disabled = !snapshot.romLoaded || !snapshot.paused || snapshot.cpu.halted;
	}
}

function requireElement<T extends Element>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) throw new Error("Required UI element was not found: " + selector);
	return element;
}

const canvas = requireElement<HTMLCanvasElement>("#screen");
const emulator = new SpaceInvaders(canvas);
new EmulatorUI(emulator, new DebuggerView());
