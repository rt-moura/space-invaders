export type Bitmap = {
	bit0: boolean;
	bit1: boolean;
	bit2: boolean;
	bit3: boolean;
	bit4: boolean;
	bit5: boolean;
	bit6: boolean;
	bit7: boolean;
};

export function readBits(value: number): Bitmap {
	return Object.fromEntries(
		Array.from({ length: 8 }, (_, bit) => [`bit${bit}`, (value & (1 << bit)) !== 0]),
	) as Bitmap;
}

export function writeBits(bits: Partial<Bitmap>): number {
	let value = 0;
	for (let bit = 0; bit < 8; bit++) {
		if (bits[`bit${bit}` as keyof Bitmap]) value |= 1 << bit;
	}
	return value;
}
