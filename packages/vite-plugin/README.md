# hai-browser-vite

Dev-only Vite plugin for [H/Ai Browser](https://marketplace.visualstudio.com/items?itemName=hai-browser.hai-browser). It tags each JSX element with the file and line that rendered it (`data-hai-src="src/App.tsx:12:7"`), so you can pick an element in VS Code's integrated browser and jump to its source. Production builds are untouched.

```sh
npm install -D hai-browser-vite
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import hai from 'hai-browser-vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [hai(), react()] });
```

See https://github.com/SnapBlock/hai-browser for details.
