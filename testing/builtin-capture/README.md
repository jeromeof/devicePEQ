# Built-in capture tests

Run the dependency-free numerical and fake-browser tests with:

```sh
node --test testing/builtin-capture/builtin-capture.test.mjs
```

These tests intentionally do not require Chrome, REW, a microphone, or a DAC.
Hardware validation will be added separately after the backend is connected to
the main verification runner.

