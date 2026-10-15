import { readBits } from "./utils.js";

export class Audio {
	private audio: AudioContext;
	private amplifier: GainNode;
	private previousPort3 = 0;
	private previousPort5 = 0;
	private ufoOscillator: OscillatorNode | null = null;
	private ufoGain: GainNode | null = null;

	constructor() {
		this.audio = new AudioContext();
		this.amplifier = this.audio.createGain();
		this.amplifier.gain.value = 0;
		this.amplifier.connect(this.audio.destination);
		const resumeAudio = () => void this.audio.resume().catch(() => {});

		// Evita bloqueio de audio automatico pelo navegador
		window.addEventListener("keydown", resumeAudio);
		window.addEventListener("pointerdown", resumeAudio);
	}

	private buzzer(frequency: number = 440, duration: number = 200) {
		const oscillator = this.audio.createOscillator();
		const gain = this.audio.createGain();

		oscillator.type = "square";
		oscillator.frequency.value = frequency;

		gain.gain.value = 0.15;

		oscillator.connect(gain);
		gain.connect(this.amplifier);
		oscillator.onended = () => {
			oscillator.disconnect();
			gain.disconnect();
		};

		oscillator.start();
		oscillator.stop(this.audio.currentTime + duration / 1000);
	}

	public play(port: 3 | 5, value: number): void {
		const bits = readBits(value);
		if (port === 3) {
			// Port 3: (discrete sounds)
			// bit 0=UFO (repeats)        SX0 0.raw
			// bit 1=Shot                 SX1 1.raw
			// bit 2=Flash (player die)   SX2 2.raw
			// bit 3=Invader die          SX3 3.raw
			// bit 4=Extended play        SX4
			// bit 5= AMP enable          SX5
			// bit 6= NC (not wired)
			// bit 7= NC (not wired)

			const previousBits = readBits(this.previousPort3);
			this.previousPort3 = value & 0xff;
			this.amplifier.gain.setTargetAtTime(bits.bit5 ? 1 : 0, this.audio.currentTime, 0.005);

			if (this.audio.state === "suspended") void this.audio.resume().catch(() => {});

			if (bits.bit0 && !this.ufoOscillator) {
				this.ufoOscillator = this.audio.createOscillator();
				this.ufoGain = this.audio.createGain();
				this.ufoOscillator.type = "sawtooth";
				this.ufoOscillator.frequency.value = 110;
				this.ufoGain.gain.value = 0.06;
				this.ufoOscillator.connect(this.ufoGain);
				this.ufoGain.connect(this.amplifier);
				this.ufoOscillator.start();
			} else if (!bits.bit0 && this.ufoOscillator) {
				this.ufoOscillator.stop();
				this.ufoOscillator.disconnect();
				this.ufoGain?.disconnect();
				this.ufoOscillator = null;
				this.ufoGain = null;
			}

			if (bits.bit1 && !previousBits.bit1) this.buzzer(440, 70); // Shot
			if (bits.bit2 && !previousBits.bit2) this.buzzer(180, 450); // Player destroyed
			if (bits.bit3 && !previousBits.bit3) this.buzzer(880, 90); // Invader destroyed
			if (bits.bit4 && !previousBits.bit4) this.buzzer(660, 160); // Extended play
		} else if (port === 5) {
			// Port 5:
			// bit 0=Fleet movement 1     SX6 4.raw
			// bit 1=Fleet movement 2     SX7 5.raw
			// bit 2=Fleet movement 3     SX8 6.raw
			// bit 3=Fleet movement 4     SX9 7.raw
			// bit 4=UFO Hit              SX10 8.raw
			// bit 5= NC (Cocktail mode control ... to flip screen)
			// bit 6= NC (not wired)
			// bit 7= NC (not wired)

			const previousBits = readBits(this.previousPort5);
			this.previousPort5 = value & 0xff;

			if (this.audio.state === "suspended") void this.audio.resume().catch(() => {});

			if (bits.bit0 && !previousBits.bit0) this.buzzer(190, 70); // Fleet movement 1
			if (bits.bit1 && !previousBits.bit1) this.buzzer(160, 70); // Fleet movement 2
			if (bits.bit2 && !previousBits.bit2) this.buzzer(130, 70); // Fleet movement 3
			if (bits.bit3 && !previousBits.bit3) this.buzzer(100, 70); // Fleet movement 4
			if (bits.bit4 && !previousBits.bit4) this.buzzer(320, 320); // UFO hit
		}
	}
}
