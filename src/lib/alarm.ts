class AlarmManagerHelper {
  private audioCtx: AudioContext | null = null;
  private isPlaying = false;
  private pulseInterval: number | null = null;
  private vibrateInterval: number | null = null;

  public unlockAudio(): void {
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextCtor();
      }
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
    } catch {
      // AudioContext unavailable
    }
  }

  public startAlarm(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.unlockAudio();

    const playSirenPulse = () => {
      if (!this.isPlaying || !this.audioCtx) return;
      try {
        if (this.audioCtx.state === 'suspended') {
          void this.audioCtx.resume();
        }
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.linearRampToValueAtTime(1320, now + 0.25);
        osc.frequency.linearRampToValueAtTime(880, now + 0.5);

        gain.gain.setValueAtTime(0.01, now);
        gain.gain.exponentialRampToValueAtTime(0.45, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.52);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.55);
      } catch {
        // Ignore audio errors
      }
    };

    playSirenPulse();
    this.pulseInterval = window.setInterval(playSirenPulse, 650);

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([500, 300, 500]);
      this.vibrateInterval = window.setInterval(() => {
        navigator.vibrate([500, 300, 500]);
      }, 1600);
    }
  }

  public stopAlarm(): void {
    this.isPlaying = false;
    if (this.pulseInterval !== null) {
      window.clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
    if (this.vibrateInterval !== null) {
      window.clearInterval(this.vibrateInterval);
      this.vibrateInterval = null;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  }
}

export const alarmHelper = new AlarmManagerHelper();
