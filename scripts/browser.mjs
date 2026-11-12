import {existsSync} from 'node:fs';
export function browserPath(chromium){return process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath());}
