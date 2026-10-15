export interface PlayerControls {
	fire: boolean;
	left: boolean;
	right: boolean;
	start: boolean;
}

export interface ControlState {
	credit: boolean;
	tilt: boolean;
	player1: PlayerControls;
	player2: PlayerControls;
}

export class Control implements ControlState {
	public credit = false;
	public tilt = false;

	public readonly player1: PlayerControls = {
		fire: false,
		left: false,
		right: false,
		start: false,
	};

	public readonly player2: PlayerControls = {
		fire: false,
		left: false,
		right: false,
		start: false,
	};

	constructor() {
		window.addEventListener("keydown", (event) => this.keyPress(event, true));
		window.addEventListener("keyup", (event) => this.keyPress(event, false));
		window.addEventListener("blur", () => this.reset());
	}

	private keyPress(event: KeyboardEvent, state: boolean): void {
		const key = event.code;

		switch (key) {
			case "ControlLeft":
			case "ControlRight":
				this.tilt = state;
				break;
			case "KeyA":
				this.player1.left = state;
				break;
			case "KeyD":
				this.player1.right = state;
				break;
			case "Space":
				this.player1.fire = state;
				break;
			case "Digit1":
				this.credit = state;
				break;
			case "Digit2":
				this.player1.start = state;
				break;
			case "Digit3":
				this.player2.start = state;
				break;
			case "ArrowLeft":
				this.player2.left = state;
				break;
			case "ArrowRight":
				this.player2.right = state;
				break;
			case "Numpad0":
				this.player2.fire = state;
				break;
			default:
				return;
		}

		event.preventDefault();
	}

	private reset(): void {
		this.credit = false;
		this.tilt = false;
		this.player1.fire = false;
		this.player1.left = false;
		this.player1.right = false;
		this.player1.start = false;
		this.player2.fire = false;
		this.player2.left = false;
		this.player2.right = false;
		this.player2.start = false;
	}
}
