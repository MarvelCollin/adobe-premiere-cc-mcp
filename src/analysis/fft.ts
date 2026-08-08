export function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}

export function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const size = frame.length;
  if ((size & (size - 1)) !== 0) {
    throw new Error(`FFT size must be a power of two, received ${size}`);
  }

  const real = Float32Array.from(frame);
  const imaginary = new Float32Array(size);

  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const swapReal = real[i];
      real[i] = real[j];
      real[j] = swapReal;
      const swapImaginary = imaginary[i];
      imaginary[i] = imaginary[j];
      imaginary[j] = swapImaginary;
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);

    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;

      for (let offset = 0; offset < length / 2; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + length / 2;

        const oddReal = real[oddIndex] * twiddleReal - imaginary[oddIndex] * twiddleImaginary;
        const oddImaginary = real[oddIndex] * twiddleImaginary + imaginary[oddIndex] * twiddleReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;

        const nextTwiddleReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }

  const bins = size / 2;
  const magnitudes = new Float32Array(bins);
  for (let bin = 0; bin < bins; bin += 1) {
    magnitudes[bin] = Math.sqrt(real[bin] * real[bin] + imaginary[bin] * imaginary[bin]);
  }
  return magnitudes;
}
