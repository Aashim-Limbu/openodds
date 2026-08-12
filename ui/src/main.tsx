// Buffer must exist before any midnight module is evaluated.
import { Buffer } from 'buffer';
(globalThis as any).Buffer ??= Buffer;
(globalThis as any).global ??= globalThis;

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
