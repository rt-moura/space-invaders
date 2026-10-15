import { InputOutput } from "./cpu.js";
import { ControlState } from "./control.js";
import { Audio } from "./audio.js";
import { writeBits } from "./utils.js";

export class IO implements InputOutput {
	private readonly control: ControlState;
	private readonly audio: Audio;
	private shiftRegister = 0;
	private shiftOffset = 0;

	constructor(control: ControlState, audio: Audio) {
		this.control = control;
		this.audio = audio;
	}

	read(port: number): number {
		switch (port) {
			case 0: {
				return writeBits({
					bit0: false, // self-test
					bit1: true,
					bit2: true,
					bit3: true,
					bit4: this.control.player1.fire,
					bit5: this.control.player1.left,
					bit6: this.control.player1.right,
				});
			}
			case 1: {
				return writeBits({
					bit0: this.control.credit,
					bit1: this.control.player2.start,
					bit2: this.control.player1.start,
					bit3: true,
					bit4: this.control.player1.fire,
					bit5: this.control.player1.left,
					bit6: this.control.player1.right,
					bit7: false,
				});
			}
			case 2: {
				return writeBits({
					// bit0 = DIP3 00 = 3 ships  10 = 5 ships
					// bit1 = DIP5 01 = 4 ships  11 = 6 ships
					bit2: this.control.tilt,
					// bit3 = DIP6 0 = extra ship at 1500, 1 = extra ship at 1000
					bit4: this.control.player2.fire,
					bit5: this.control.player2.left,
					bit6: this.control.player2.right,
					// bit7 = DIP7 Coin info displayed in demo screen 0=ON
				});
			}
			case 3: {
				return (this.shiftRegister >> (8 - this.shiftOffset)) & 0xff;
			}
			default:
				throw new Error("Porta de leitura não encontrada");
		}
	}

	write(port: number, value: number): void {
		switch (port) {
			case 2: {
				this.shiftOffset = value & 0x07;
				break;
			}
			case 3: {
				this.audio.play(3, value);
				break;
			}
			case 4: {
				const shiftFirstByte = (this.shiftRegister >> 8) & 0xff;
				const newFirstByte = value & 0xff;
				this.shiftRegister = (newFirstByte << 8) | shiftFirstByte;
				break;
			}
			case 5: {
				this.audio.play(5, value);
				break;
			}
			case 6: {
				// Reset do watchdog
				break;
			}
			default:
				throw new Error("Porta de escrita não encontrada");
		}
	}
}
