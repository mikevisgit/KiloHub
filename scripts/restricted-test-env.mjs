import process from 'node:process';

// test-electron merges process.env again; sanitize the parent as well as overrides.
export async function withRestrictedToolPath(run) {
  const saved = Object.entries(process.env).filter(([key]) => key.toLowerCase() === 'path');
  const clear = () => {
    for (const key of Object.keys(process.env)) {
      if (key.toLowerCase() === 'path') delete process.env[key];
    }
  };
  clear();
  process.env.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  try { return await run(); }
  finally {
    clear();
    for (const [key, value] of saved) process.env[key] = value;
  }
}
