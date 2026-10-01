export class Memory {
	private readonly data = new Uint8Array(0x10000);

	public load(data: Uint8Array, startAddress: number): void {
		this.data.set(data, startAddress);
	}

	public writeByte(address: number, value: number): void {
		this.data[address & 0xffff] = value & 0xff;
	}

	public readByte(address: number): number {
		return this.data[address & 0xffff];
	}

	public writeWord(address: number, value: number): void {
		this.writeByte(address, value);
		this.writeByte(address + 1, value >> 8);
	}

	public readWord(address: number): number {
		const low = this.readByte(address);
		const high = this.readByte(address + 1);

		return low | (high << 8);
	}
}
