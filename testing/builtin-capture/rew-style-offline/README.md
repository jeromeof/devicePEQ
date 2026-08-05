# Offline REW-style swept-sine processor

This directory is deliberately isolated from the live built-in capture path.
It contains an experimental matched-inverse swept-sine processor and tests.

The processor accepts the raw emitted sweep and raw captured samples, creates a
time-domain impulse response, locates the direct response, applies an explicit
pre/post window, and divides by the identically processed reference sweep.

The downloaded JSON and REW text exports contain frequency-response curves, not
raw browser waveforms. They are used here for output-shape comparisons only;
they cannot prove that the new processor works on a real browser capture.

Run the isolated tests with:

```sh
node --test testing/builtin-capture/rew-style-offline/*.test.mjs
```

To reproduce the real-export comparison report:

```sh
node testing/builtin-capture/rew-style-offline/compare-real.mjs
```

The current exports show approximately 2.1 dB RMSE for the older built-in
captures versus the supplied REW curve. The failed experimental capture is
approximately 2.9 dB RMSE with larger local errors, so it is not ready to
replace the live processor.

Nothing in this directory is imported by the live verification page.
