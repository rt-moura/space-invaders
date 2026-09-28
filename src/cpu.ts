import { Memory } from "./memory.js";

export interface Flags {
	sign: boolean;
	zero: boolean;
	auxiliaryCarry: boolean;
	parity: boolean;
	carry: boolean;
	toByte(): number;
	fromByte(value: number): void;
}

export interface Registers {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	h: number;
	l: number;
	pc: number;
	sp: number;
	flags: Flags;
	bc: number;
	de: number;
	hl: number;
	psw: number;
}

export interface InputOutput {
	read(port: number): number;
	write(port: number, value: number): void;
}

export type Instruction = { mnemonic: string; length: number; duration: number; opcode: number; execute(): void };

export class CPU {
	private registers: Registers;
	private readonly memory: Memory;
	private readonly inputOutput: InputOutput;
	private halted = false;
	private interruptsEnabled = false;
	private interruptEnableDelay = 0;
	private cycles = 0;
	private cycleWatcher?: (cycles: number) => void;

	constructor(memory: Memory, inputOutput: InputOutput = { read: () => 0, write: () => {} }) {
		this.memory = memory;
		this.inputOutput = inputOutput;
		this.registers = this.getRegisters();
	}

	public reset(): void {
		this.registers = this.getRegisters();
		this.halted = false;
		this.interruptsEnabled = false;
		this.interruptEnableDelay = 0;
		this.cycles = 0;
	}

	public watch(callback: (cycles: number) => void): void {
		this.cycleWatcher = callback;
	}

	public getState() {
		const registers = this.registers;
		const flags = registers.flags;

		return {
			registers: {
				a: registers.a,
				b: registers.b,
				c: registers.c,
				d: registers.d,
				e: registers.e,
				h: registers.h,
				l: registers.l,
				pc: registers.pc,
				sp: registers.sp,
				bc: registers.bc,
				de: registers.de,
				hl: registers.hl,
				psw: registers.psw,
				flags: {
					sign: flags.sign,
					zero: flags.zero,
					auxiliaryCarry: flags.auxiliaryCarry,
					parity: flags.parity,
					carry: flags.carry,
				},
			},
			halted: this.halted,
			interruptsEnabled: this.interruptsEnabled,
			interruptEnableDelay: this.interruptEnableDelay,
			cycles: this.cycles,
		};
	}

	public interrupt(opcode: number): boolean {
		if (!this.interruptsEnabled) return false;

		this.interruptsEnabled = false;
		this.interruptEnableDelay = 0;
		this.halted = false;

		const instruction = this.getInstruction(opcode & 0xff);
		instruction.execute();
		this.cycles += instruction.duration;

		return true;
	}

	private getRegisters(): Registers {
		return {
			a: 0,
			b: 0,
			c: 0,
			d: 0,
			e: 0,
			h: 0,
			l: 0,
			pc: 0,
			sp: 0,
			flags: {
				sign: false,
				zero: false,
				auxiliaryCarry: false,
				parity: false,
				carry: false,

				toByte(): number {
					return (
						(this.sign ? 0x80 : 0) |
						(this.zero ? 0x40 : 0) |
						(this.auxiliaryCarry ? 0x10 : 0) |
						(this.parity ? 0x04 : 0) |
						0x02 |
						(this.carry ? 0x01 : 0)
					);
				},

				fromByte(value: number): void {
					this.sign = (value & 0x80) !== 0;
					this.zero = (value & 0x40) !== 0;
					this.auxiliaryCarry = (value & 0x10) !== 0;
					this.parity = (value & 0x04) !== 0;
					this.carry = (value & 0x01) !== 0;
				},
			},

			get bc(): number {
				return (this.b << 8) | this.c;
			},

			set bc(value: number) {
				this.b = (value >> 8) & 0xff;
				this.c = value & 0xff;
			},

			get de(): number {
				return (this.d << 8) | this.e;
			},

			set de(value: number) {
				this.d = (value >> 8) & 0xff;
				this.e = value & 0xff;
			},

			get hl(): number {
				return (this.h << 8) | this.l;
			},

			set hl(value: number) {
				this.h = (value >> 8) & 0xff;
				this.l = value & 0xff;
			},

			get psw(): number {
				return (this.a << 8) | this.flags.toByte();
			},

			set psw(value: number) {
				this.a = (value >> 8) & 0xff;
				this.flags.fromByte(value & 0xff);
			},
		};
	}

	private getOperands(code: number) {
		const operands = ["b", "c", "d", "e", "h", "l", "m", "a"] as const;

		return operands[code & 0x07];
	}

	private getPairOperands(code: number) {
		const pairOperands = [
			{ register: "bc", name: "b" },
			{ register: "de", name: "d" },
			{ register: "hl", name: "h" },
			{ register: "sp", name: "sp" },
		] as const;

		return pairOperands[code & 0x03];
	}

	private getConditions(code: number) {
		const conditions = ["nz", "z", "nc", "c", "po", "pe", "p", "m"] as const;

		return conditions[code & 0x07];
	}

	private fetchNextByte(): number {
		const value = this.memory.readByte(this.registers.pc);
		this.registers.pc = (this.registers.pc + 1) & 0xffff;

		return value;
	}

	private fetchNextWord(): number {
		const low = this.fetchNextByte();
		const high = this.fetchNextByte();

		return low | (high << 8);
	}

	private pushStackWord(value: number): void {
		this.registers.sp = (this.registers.sp - 1) & 0xffff;
		this.memory.writeByte(this.registers.sp, value >> 8);

		this.registers.sp = (this.registers.sp - 1) & 0xffff;
		this.memory.writeByte(this.registers.sp, value);
	}

	private popStackWord(): number {
		const low = this.memory.readByte(this.registers.sp);
		this.registers.sp = (this.registers.sp + 1) & 0xffff;

		const high = this.memory.readByte(this.registers.sp);
		this.registers.sp = (this.registers.sp + 1) & 0xffff;

		return low | (high << 8);
	}

	private readRegister(code: number): number {
		const operand = this.getOperands(code);

		return operand == "m" ? this.memory.readByte(this.registers.hl) : this.registers[operand];
	}

	private writeRegister(code: number, value: number): void {
		const operand = this.getOperands(code);

		if (operand === "m") {
			this.memory.writeByte(this.registers.hl, value);
			return;
		}

		this.registers[operand] = value & 0xff;
	}

	private setSignZeroParity(value: number): void {
		const flags = this.registers.flags;
		flags.sign = (value & 0x80) !== 0;
		flags.zero = value === 0;

		let ones = 0;
		for (let bit = 0; bit < 8; bit++) {
			ones += (value >> bit) & 1;
		}
		flags.parity = ones % 2 === 0;
	}

	private NOP(opcode: number): Instruction {
		return { mnemonic: "NOP", length: 1, duration: 4, opcode: opcode, execute: () => {} };
	}

	private LXI(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x03;
		const { register, name } = this.getPairOperands(pairCode);

		return {
			mnemonic: `LXI ${name.toUpperCase()},d16`,
			length: 3,
			duration: 10,
			opcode: opcode,
			execute: () => {
				this.registers[register] = this.fetchNextWord();
			},
		};
	}

	private STAX(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x01;
		const { register, name } = this.getPairOperands(pairCode);

		return {
			mnemonic: `STAX ${name.toUpperCase()}`,
			length: 1,
			duration: 7,
			opcode: opcode,
			execute: () => {
				this.memory.writeByte(this.registers[register], this.registers.a);
			},
		};
	}

	private INX(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x03;
		const { register, name } = this.getPairOperands(pairCode);

		return {
			mnemonic: `INX ${name.toUpperCase()}`,
			length: 1,
			duration: 5,
			opcode: opcode,
			execute: () => {
				this.registers[register] = (this.registers[register] + 1) & 0xffff;
			},
		};
	}

	private INR(opcode: number): Instruction {
		const operandCode = (opcode >> 3) & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `INR ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 10 : 5,
			opcode: opcode,
			execute: () => {
				const value = this.readRegister(operandCode);
				const result = (value + 1) & 0xff;

				this.registers.flags.auxiliaryCarry = (value & 0x0f) === 0x0f;
				this.setSignZeroParity(result);
				this.writeRegister(operandCode, result);
			},
		};
	}

	private DCR(opcode: number): Instruction {
		const operandCode = (opcode >> 3) & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `DCR ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 10 : 5,
			opcode: opcode,
			execute: () => {
				const value = this.readRegister(operandCode);
				const result = (value - 1) & 0xff;

				this.registers.flags.auxiliaryCarry = (value & 0x0f) !== 0;
				this.setSignZeroParity(result);
				this.writeRegister(operandCode, result);
			},
		};
	}

	private MVI(opcode: number): Instruction {
		const operandCode = (opcode >> 3) & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `MVI ${operand.toUpperCase()},d8`,
			length: 2,
			duration: operand === "m" ? 10 : 7,
			opcode: opcode,
			execute: () => {
				this.writeRegister(operandCode, this.fetchNextByte());
			},
		};
	}

	private RLC(opcode: number): Instruction {
		return {
			mnemonic: "RLC",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				const bit7 = this.registers.a >> 7;
				this.registers.a = ((this.registers.a << 1) | bit7) & 0xff;
				this.registers.flags.carry = bit7 !== 0;
			},
		};
	}

	private DAD(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x03;
		const { register, name } = this.getPairOperands(pairCode);

		return {
			mnemonic: `DAD ${name.toUpperCase()}`,
			length: 1,
			duration: 10,
			opcode: opcode,
			execute: () => {
				const result = this.registers.hl + this.registers[register];
				this.registers.flags.carry = result > 0xffff;
				this.registers.hl = result & 0xffff;
			},
		};
	}

	private LDAX(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x01;
		const { register, name } = this.getPairOperands(pairCode);

		return {
			mnemonic: `LDAX ${name.toUpperCase()}`,
			length: 1,
			duration: 7,
			opcode: opcode,
			execute: () => {
				this.registers.a = this.memory.readByte(this.registers[register]);
			},
		};
	}

	private DCX(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x03;
		const { register, name } = this.getPairOperands(pairCode);

		return {
			mnemonic: `DCX ${name.toUpperCase()}`,
			length: 1,
			duration: 5,
			opcode: opcode,
			execute: () => {
				this.registers[register] = (this.registers[register] - 1) & 0xffff;
			},
		};
	}

	private RRC(opcode: number): Instruction {
		return {
			mnemonic: "RRC",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				const bit0 = this.registers.a & 0x01;
				this.registers.a = (this.registers.a >> 1) | (bit0 << 7);
				this.registers.flags.carry = bit0 !== 0;
			},
		};
	}

	private RAL(opcode: number): Instruction {
		return {
			mnemonic: "RAL",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				const bit7 = this.registers.a >> 7;
				const carry = this.registers.flags.carry ? 1 : 0;
				this.registers.a = ((this.registers.a << 1) | carry) & 0xff;
				this.registers.flags.carry = bit7 !== 0;
			},
		};
	}

	private RAR(opcode: number): Instruction {
		return {
			mnemonic: "RAR",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				const bit0 = this.registers.a & 0x01;
				const carry = this.registers.flags.carry ? 0x80 : 0;
				this.registers.a = (this.registers.a >> 1) | carry;
				this.registers.flags.carry = bit0 !== 0;
			},
		};
	}

	private SHLD(opcode: number): Instruction {
		return {
			mnemonic: "SHLD a16",
			length: 3,
			duration: 16,
			opcode: opcode,
			execute: () => {
				const address = this.fetchNextWord();
				this.memory.writeByte(address, this.registers.l);
				this.memory.writeByte(address + 1, this.registers.h);
			},
		};
	}

	private DAA(opcode: number): Instruction {
		return {
			mnemonic: "DAA",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				const value = this.registers.a;
				let correction = 0;
				let carry = this.registers.flags.carry;

				if ((value & 0x0f) > 9 || this.registers.flags.auxiliaryCarry) correction |= 0x06;
				if (value > 0x99 || this.registers.flags.carry) {
					correction |= 0x60;
					carry = true;
				}

				const result = value + correction;
				this.registers.flags.auxiliaryCarry = (value & 0x0f) + (correction & 0x0f) > 0x0f;
				this.registers.flags.carry = carry || result > 0xff;
				this.registers.a = result & 0xff;
				this.setSignZeroParity(this.registers.a);
			},
		};
	}

	private LHLD(opcode: number): Instruction {
		return {
			mnemonic: "LHLD a16",
			length: 3,
			duration: 16,
			opcode: opcode,
			execute: () => {
				const address = this.fetchNextWord();
				this.registers.l = this.memory.readByte(address);
				this.registers.h = this.memory.readByte(address + 1);
			},
		};
	}

	private CMA(opcode: number): Instruction {
		return {
			mnemonic: "CMA",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				this.registers.a = ~this.registers.a & 0xff;
			},
		};
	}

	private STA(opcode: number): Instruction {
		return {
			mnemonic: "STA a16",
			length: 3,
			duration: 13,
			opcode: opcode,
			execute: () => {
				this.memory.writeByte(this.fetchNextWord(), this.registers.a);
			},
		};
	}

	private STC(opcode: number): Instruction {
		return {
			mnemonic: "STC",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				this.registers.flags.carry = true;
			},
		};
	}

	private LDA(opcode: number): Instruction {
		return {
			mnemonic: "LDA a16",
			length: 3,
			duration: 13,
			opcode: opcode,
			execute: () => {
				this.registers.a = this.memory.readByte(this.fetchNextWord());
			},
		};
	}

	private CMC(opcode: number): Instruction {
		return {
			mnemonic: "CMC",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				this.registers.flags.carry = !this.registers.flags.carry;
			},
		};
	}

	private MOV(opcode: number): Instruction {
		const destinationCode = (opcode >> 3) & 0x07;
		const sourceCode = opcode & 0x07;
		const destination = this.getOperands(destinationCode);
		const source = this.getOperands(sourceCode);

		return {
			mnemonic: `MOV ${destination.toUpperCase()},${source.toUpperCase()}`,
			length: 1,
			duration: destination === "m" || source === "m" ? 7 : 5,
			opcode: opcode,
			execute: () => {
				this.writeRegister(destinationCode, this.readRegister(sourceCode));
			},
		};
	}

	private HLT(opcode: number): Instruction {
		return {
			mnemonic: "HLT",
			length: 1,
			duration: 7,
			opcode: opcode,
			execute: () => {
				this.halted = true;
			},
		};
	}

	private ADD(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `ADD ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.readRegister(operandCode);
				const result = accumulator + value;

				this.registers.flags.carry = result > 0xff;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (value & 0x0f) > 0x0f;
				this.registers.a = result & 0xff;
				this.setSignZeroParity(this.registers.a);
			},
		};
	}

	private ADC(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `ADC ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.readRegister(operandCode);
				const carry = this.registers.flags.carry ? 1 : 0;
				const result = accumulator + value + carry;

				this.registers.flags.carry = result > 0xff;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (value & 0x0f) + carry > 0x0f;
				this.registers.a = result & 0xff;
				this.setSignZeroParity(this.registers.a);
			},
		};
	}

	private SUB(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `SUB ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.readRegister(operandCode);
				const result = (accumulator - value) & 0xff;

				this.registers.flags.carry = accumulator < value;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (~value & 0x0f) + 1 > 0x0f;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private SBB(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `SBB ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.readRegister(operandCode);
				const borrow = this.registers.flags.carry ? 1 : 0;
				const result = (accumulator - value - borrow) & 0xff;

				this.registers.flags.carry = accumulator < value + borrow;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (~value & 0x0f) + (1 - borrow) > 0x0f;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private ANA(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `ANA ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.readRegister(operandCode);
				const result = accumulator & value;

				this.registers.flags.carry = false;
				this.registers.flags.auxiliaryCarry = ((accumulator | value) & 0x08) !== 0;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private XRA(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `XRA ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const result = this.registers.a ^ this.readRegister(operandCode);
				this.registers.flags.carry = false;
				this.registers.flags.auxiliaryCarry = false;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private ORA(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `ORA ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const result = this.registers.a | this.readRegister(operandCode);
				this.registers.flags.carry = false;
				this.registers.flags.auxiliaryCarry = false;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private CMP(opcode: number): Instruction {
		const operandCode = opcode & 0x07;
		const operand = this.getOperands(operandCode);

		return {
			mnemonic: `CMP ${operand.toUpperCase()}`,
			length: 1,
			duration: operand === "m" ? 7 : 4,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.readRegister(operandCode);
				const result = (accumulator - value) & 0xff;

				this.registers.flags.carry = accumulator < value;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (~value & 0x0f) + 1 > 0x0f;
				this.setSignZeroParity(result);
			},
		};
	}

	private POP(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x03;
		const { register, name } = this.getPairOperands(pairCode);
		const operand = pairCode === 3 ? "psw" : register;
		const operandName = pairCode === 3 ? "psw" : name;

		return {
			mnemonic: `POP ${operandName.toUpperCase()}`,
			length: 1,
			duration: 10,
			opcode: opcode,
			execute: () => {
				this.registers[operand] = this.popStackWord();
			},
		};
	}

	private JUMP(opcode: number): Instruction {
		const unconditional = opcode === 0xc3 || opcode === 0xcb;
		const conditionCode = (opcode >> 3) & 0x07;
		const condition = this.getConditions(conditionCode);
		const conditionMet = (): boolean => {
			const flags = this.registers.flags;

			switch (condition) {
				case "nz":
					return !flags.zero;
				case "z":
					return flags.zero;
				case "nc":
					return !flags.carry;
				case "c":
					return flags.carry;
				case "po":
					return !flags.parity;
				case "pe":
					return flags.parity;
				case "p":
					return !flags.sign;
				case "m":
					return flags.sign;
			}
		};

		return {
			mnemonic: unconditional ? "JMP a16" : `J${condition.toUpperCase()} a16`,
			length: 3,
			duration: 10,
			opcode: opcode,
			execute: () => {
				const address = this.fetchNextWord();
				if (unconditional || conditionMet()) this.registers.pc = address;
			},
		};
	}

	private PUSH(opcode: number): Instruction {
		const pairCode = (opcode >> 4) & 0x03;
		const { register, name } = this.getPairOperands(pairCode);
		const operand = pairCode === 3 ? "psw" : register;
		const operandName = pairCode === 3 ? "psw" : name;

		return {
			mnemonic: `PUSH ${operandName.toUpperCase()}`,
			length: 1,
			duration: 11,
			opcode: opcode,
			execute: () => {
				this.pushStackWord(this.registers[operand]);
			},
		};
	}

	private ADI(opcode: number): Instruction {
		return {
			mnemonic: "ADI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.fetchNextByte();
				const result = accumulator + value;

				this.registers.flags.carry = result > 0xff;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (value & 0x0f) > 0x0f;
				this.registers.a = result & 0xff;
				this.setSignZeroParity(this.registers.a);
			},
		};
	}

	private RST(opcode: number): Instruction {
		const vector = (opcode >> 3) & 0x07;

		return {
			mnemonic: `RST ${vector}`,
			length: 1,
			duration: 11,
			opcode: opcode,
			execute: () => {
				this.pushStackWord(this.registers.pc);
				this.registers.pc = vector << 3;
			},
		};
	}

	private RETURN(opcode: number): Instruction {
		const unconditional = opcode === 0xc9 || opcode === 0xd9;
		const conditionCode = (opcode >> 3) & 0x07;
		const condition = this.getConditions(conditionCode);
		const conditionMet = (): boolean => {
			const flags = this.registers.flags;

			switch (condition) {
				case "nz":
					return !flags.zero;
				case "z":
					return flags.zero;
				case "nc":
					return !flags.carry;
				case "c":
					return flags.carry;
				case "po":
					return !flags.parity;
				case "pe":
					return flags.parity;
				case "p":
					return !flags.sign;
				case "m":
					return flags.sign;
			}
		};

		return {
			mnemonic: unconditional ? "RET" : `R${condition.toUpperCase()}`,
			length: 1,
			duration: unconditional ? 10 : conditionMet() ? 11 : 5,
			opcode: opcode,
			execute: () => {
				if (unconditional || conditionMet()) this.registers.pc = this.popStackWord();
			},
		};
	}

	private CALL(opcode: number): Instruction {
		const unconditional = opcode === 0xcd || opcode === 0xdd || opcode === 0xed || opcode === 0xfd;
		const conditionCode = (opcode >> 3) & 0x07;
		const condition = this.getConditions(conditionCode);
		const conditionMet = (): boolean => {
			const flags = this.registers.flags;

			switch (condition) {
				case "nz":
					return !flags.zero;
				case "z":
					return flags.zero;
				case "nc":
					return !flags.carry;
				case "c":
					return flags.carry;
				case "po":
					return !flags.parity;
				case "pe":
					return flags.parity;
				case "p":
					return !flags.sign;
				case "m":
					return flags.sign;
			}
		};

		return {
			mnemonic: unconditional ? "CALL a16" : `C${condition.toUpperCase()} a16`,
			length: 3,
			duration: unconditional || conditionMet() ? 17 : 11,
			opcode: opcode,
			execute: () => {
				const address = this.fetchNextWord();
				if (unconditional || conditionMet()) {
					this.pushStackWord(this.registers.pc);
					this.registers.pc = address;
				}
			},
		};
	}

	private ACI(opcode: number): Instruction {
		return {
			mnemonic: "ACI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.fetchNextByte();
				const carry = this.registers.flags.carry ? 1 : 0;
				const result = accumulator + value + carry;

				this.registers.flags.carry = result > 0xff;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (value & 0x0f) + carry > 0x0f;
				this.registers.a = result & 0xff;
				this.setSignZeroParity(this.registers.a);
			},
		};
	}

	private OUT(opcode: number): Instruction {
		return {
			mnemonic: "OUT d8",
			length: 2,
			duration: 10,
			opcode: opcode,
			execute: () => {
				this.inputOutput.write(this.fetchNextByte(), this.registers.a);
			},
		};
	}

	private SUI(opcode: number): Instruction {
		return {
			mnemonic: "SUI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.fetchNextByte();
				const result = (accumulator - value) & 0xff;

				this.registers.flags.carry = accumulator < value;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (~value & 0x0f) + 1 > 0x0f;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private IN(opcode: number): Instruction {
		return {
			mnemonic: "IN d8",
			length: 2,
			duration: 10,
			opcode: opcode,
			execute: () => {
				this.registers.a = this.inputOutput.read(this.fetchNextByte()) & 0xff;
			},
		};
	}

	private SBI(opcode: number): Instruction {
		return {
			mnemonic: "SBI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.fetchNextByte();
				const borrow = this.registers.flags.carry ? 1 : 0;
				const result = (accumulator - value - borrow) & 0xff;

				this.registers.flags.carry = accumulator < value + borrow;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (~value & 0x0f) + (1 - borrow) > 0x0f;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private XTHL(opcode: number): Instruction {
		return {
			mnemonic: "XTHL",
			length: 1,
			duration: 18,
			opcode: opcode,
			execute: () => {
				const low = this.memory.readByte(this.registers.sp);
				const high = this.memory.readByte(this.registers.sp + 1);

				this.memory.writeByte(this.registers.sp, this.registers.l);
				this.memory.writeByte(this.registers.sp + 1, this.registers.h);
				this.registers.l = low;
				this.registers.h = high;
			},
		};
	}

	private ANI(opcode: number): Instruction {
		return {
			mnemonic: "ANI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.fetchNextByte();
				const result = accumulator & value;

				this.registers.flags.carry = false;
				this.registers.flags.auxiliaryCarry = ((accumulator | value) & 0x08) !== 0;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private PCHL(opcode: number): Instruction {
		return {
			mnemonic: "PCHL",
			length: 1,
			duration: 5,
			opcode: opcode,
			execute: () => {
				this.registers.pc = this.registers.hl;
			},
		};
	}

	private XCHG(opcode: number): Instruction {
		return {
			mnemonic: "XCHG",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				const de = this.registers.de;
				this.registers.de = this.registers.hl;
				this.registers.hl = de;
			},
		};
	}

	private XRI(opcode: number): Instruction {
		return {
			mnemonic: "XRI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const result = this.registers.a ^ this.fetchNextByte();
				this.registers.flags.carry = false;
				this.registers.flags.auxiliaryCarry = false;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private DI(opcode: number): Instruction {
		return {
			mnemonic: "DI",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				this.interruptsEnabled = false;
				this.interruptEnableDelay = 0;
			},
		};
	}

	private ORI(opcode: number): Instruction {
		return {
			mnemonic: "ORI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const result = this.registers.a | this.fetchNextByte();
				this.registers.flags.carry = false;
				this.registers.flags.auxiliaryCarry = false;
				this.registers.a = result;
				this.setSignZeroParity(result);
			},
		};
	}

	private SPHL(opcode: number): Instruction {
		return {
			mnemonic: "SPHL",
			length: 1,
			duration: 5,
			opcode: opcode,
			execute: () => {
				this.registers.sp = this.registers.hl;
			},
		};
	}

	private EI(opcode: number): Instruction {
		return {
			mnemonic: "EI",
			length: 1,
			duration: 4,
			opcode: opcode,
			execute: () => {
				this.interruptEnableDelay = 2;
			},
		};
	}

	private CPI(opcode: number): Instruction {
		return {
			mnemonic: "CPI d8",
			length: 2,
			duration: 7,
			opcode: opcode,
			execute: () => {
				const accumulator = this.registers.a;
				const value = this.fetchNextByte();
				const result = (accumulator - value) & 0xff;

				this.registers.flags.carry = accumulator < value;
				this.registers.flags.auxiliaryCarry = (accumulator & 0x0f) + (~value & 0x0f) + 1 > 0x0f;
				this.setSignZeroParity(result);
			},
		};
	}

	private getInstruction(opcode: number): Instruction {
		switch (opcode) {
			case 0x00:
			case 0x08:
			case 0x10:
			case 0x18:
			case 0x20:
			case 0x28:
			case 0x30:
			case 0x38:
				return this.NOP(opcode);

			case 0x01:
			case 0x11:
			case 0x21:
			case 0x31:
				return this.LXI(opcode);

			case 0x02:
			case 0x12:
				return this.STAX(opcode);

			case 0x03:
			case 0x13:
			case 0x23:
			case 0x33:
				return this.INX(opcode);

			case 0x04:
			case 0x0c:
			case 0x14:
			case 0x1c:
			case 0x24:
			case 0x2c:
			case 0x34:
			case 0x3c:
				return this.INR(opcode);

			case 0x05:
			case 0x0d:
			case 0x15:
			case 0x1d:
			case 0x25:
			case 0x2d:
			case 0x35:
			case 0x3d:
				return this.DCR(opcode);

			case 0x06:
			case 0x0e:
			case 0x16:
			case 0x1e:
			case 0x26:
			case 0x2e:
			case 0x36:
			case 0x3e:
				return this.MVI(opcode);

			case 0x07:
				return this.RLC(opcode);

			case 0x09:
			case 0x19:
			case 0x29:
			case 0x39:
				return this.DAD(opcode);

			case 0x0a:
			case 0x1a:
				return this.LDAX(opcode);

			case 0x0b:
			case 0x1b:
			case 0x2b:
			case 0x3b:
				return this.DCX(opcode);

			case 0x0f:
				return this.RRC(opcode);

			case 0x17:
				return this.RAL(opcode);

			case 0x1f:
				return this.RAR(opcode);

			case 0x22:
				return this.SHLD(opcode);

			case 0x27:
				return this.DAA(opcode);

			case 0x2a:
				return this.LHLD(opcode);

			case 0x2f:
				return this.CMA(opcode);

			case 0x32:
				return this.STA(opcode);

			case 0x37:
				return this.STC(opcode);

			case 0x3a:
				return this.LDA(opcode);

			case 0x3f:
				return this.CMC(opcode);

			case 0x40:
			case 0x41:
			case 0x42:
			case 0x43:
			case 0x44:
			case 0x45:
			case 0x46:
			case 0x47:
			case 0x48:
			case 0x49:
			case 0x4a:
			case 0x4b:
			case 0x4c:
			case 0x4d:
			case 0x4e:
			case 0x4f:
			case 0x50:
			case 0x51:
			case 0x52:
			case 0x53:
			case 0x54:
			case 0x55:
			case 0x56:
			case 0x57:
			case 0x58:
			case 0x59:
			case 0x5a:
			case 0x5b:
			case 0x5c:
			case 0x5d:
			case 0x5e:
			case 0x5f:
			case 0x60:
			case 0x61:
			case 0x62:
			case 0x63:
			case 0x64:
			case 0x65:
			case 0x66:
			case 0x67:
			case 0x68:
			case 0x69:
			case 0x6a:
			case 0x6b:
			case 0x6c:
			case 0x6d:
			case 0x6e:
			case 0x6f:
			case 0x70:
			case 0x71:
			case 0x72:
			case 0x73:
			case 0x74:
			case 0x75:
			case 0x77:
			case 0x78:
			case 0x79:
			case 0x7a:
			case 0x7b:
			case 0x7c:
			case 0x7d:
			case 0x7e:
			case 0x7f:
				return this.MOV(opcode);

			case 0x76:
				return this.HLT(opcode);

			case 0x80:
			case 0x81:
			case 0x82:
			case 0x83:
			case 0x84:
			case 0x85:
			case 0x86:
			case 0x87:
				return this.ADD(opcode);

			case 0x88:
			case 0x89:
			case 0x8a:
			case 0x8b:
			case 0x8c:
			case 0x8d:
			case 0x8e:
			case 0x8f:
				return this.ADC(opcode);

			case 0x90:
			case 0x91:
			case 0x92:
			case 0x93:
			case 0x94:
			case 0x95:
			case 0x96:
			case 0x97:
				return this.SUB(opcode);

			case 0x98:
			case 0x99:
			case 0x9a:
			case 0x9b:
			case 0x9c:
			case 0x9d:
			case 0x9e:
			case 0x9f:
				return this.SBB(opcode);

			case 0xa0:
			case 0xa1:
			case 0xa2:
			case 0xa3:
			case 0xa4:
			case 0xa5:
			case 0xa6:
			case 0xa7:
				return this.ANA(opcode);

			case 0xa8:
			case 0xa9:
			case 0xaa:
			case 0xab:
			case 0xac:
			case 0xad:
			case 0xae:
			case 0xaf:
				return this.XRA(opcode);

			case 0xb0:
			case 0xb1:
			case 0xb2:
			case 0xb3:
			case 0xb4:
			case 0xb5:
			case 0xb6:
			case 0xb7:
				return this.ORA(opcode);

			case 0xb8:
			case 0xb9:
			case 0xba:
			case 0xbb:
			case 0xbc:
			case 0xbd:
			case 0xbe:
			case 0xbf:
				return this.CMP(opcode);

			case 0xc0:
			case 0xc8:
			case 0xc9:
			case 0xd0:
			case 0xd8:
			case 0xd9:
			case 0xe0:
			case 0xe8:
			case 0xf0:
			case 0xf8:
				return this.RETURN(opcode);

			case 0xc1:
			case 0xd1:
			case 0xe1:
			case 0xf1:
				return this.POP(opcode);

			case 0xc2:
			case 0xc3:
			case 0xca:
			case 0xcb:
			case 0xd2:
			case 0xda:
			case 0xe2:
			case 0xea:
			case 0xf2:
			case 0xfa:
				return this.JUMP(opcode);

			case 0xc4:
			case 0xcc:
			case 0xcd:
			case 0xd4:
			case 0xdc:
			case 0xdd:
			case 0xe4:
			case 0xec:
			case 0xed:
			case 0xf4:
			case 0xfc:
			case 0xfd:
				return this.CALL(opcode);

			case 0xc5:
			case 0xd5:
			case 0xe5:
			case 0xf5:
				return this.PUSH(opcode);

			case 0xc6:
				return this.ADI(opcode);

			case 0xc7:
			case 0xcf:
			case 0xd7:
			case 0xdf:
			case 0xe7:
			case 0xef:
			case 0xf7:
			case 0xff:
				return this.RST(opcode);

			case 0xce:
				return this.ACI(opcode);

			case 0xd3:
				return this.OUT(opcode);

			case 0xd6:
				return this.SUI(opcode);

			case 0xdb:
				return this.IN(opcode);

			case 0xde:
				return this.SBI(opcode);

			case 0xe3:
				return this.XTHL(opcode);

			case 0xe6:
				return this.ANI(opcode);

			case 0xe9:
				return this.PCHL(opcode);

			case 0xeb:
				return this.XCHG(opcode);

			case 0xee:
				return this.XRI(opcode);

			case 0xf3:
				return this.DI(opcode);

			case 0xf6:
				return this.ORI(opcode);

			case 0xf9:
				return this.SPHL(opcode);

			case 0xfb:
				return this.EI(opcode);

			case 0xfe:
				return this.CPI(opcode);

			default:
				throw new Error(`Opcode: 0x${opcode.toString(16).padStart(2, "0").toUpperCase()} não implementado`);
		}
	}

	step(): number {
		if (this.halted) {
			this.cycles += 4;
			return 4;
		}

		const instruction = this.getInstruction(this.fetchNextByte());

		instruction.execute();

		// Check interruptions
		if (this.interruptEnableDelay > 0) {
			this.interruptEnableDelay--;

			if (this.interruptEnableDelay === 0) {
				this.interruptsEnabled = true;
			}
		}

		this.cycles += instruction.duration;

		return instruction.duration;
	}

	run(cycles: number): void {
		while (this.cycles < cycles) {
			this.step();
			this.cycleWatcher?.(this.cycles);
		}

		this.cycles -= cycles;
		this.cycleWatcher?.(this.cycles);
	}
}
