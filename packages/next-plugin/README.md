# hai-browser-next

Dev-only Next.js plugin (Turbopack and webpack) for [H/Ai Browser](https://marketplace.visualstudio.com/items?itemName=hai-browser.hai-browser). It tags each JSX element with the file and line that rendered it (`data-hai-src="app/page.tsx:12:7"`), so you can pick an element in VS Code's integrated browser and jump to its source. It only changes the config under `next dev`.

```sh
npm install -D hai-browser-next
```

```ts
// next.config.ts
import { withHaiBrowser } from 'hai-browser-next';

export default withHaiBrowser({ /* your config */ });
```

Other webpack setups can use the loader directly: `{ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: ['hai-browser-next/loader'] }`.

See https://github.com/SnapBlock/hai-browser for details.
