# wayland-ts

данный проект работает только на половину.
в wayland нужно передававть файовый дескриптор через сокет, и js это не умеет.
есть библиотека usocket, но она не работает(возможно из-за того, что я использую bunjs, но мне лень переделывать под node)

To install dependencies:

```bash
bun install
```

To run:

```bash
bun start
```

This project was created using `bun init` in bun v1.2.20. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
