import { createApp } from './ui/app.js';

const app = createApp(document.getElementById('app'));

// Exposed for the verification harness and for anyone poking at the console.
window.__veilforge = app;

const ready = () => document.documentElement.setAttribute('data-ready', '1');
if (document.readyState === 'complete') ready();
else window.addEventListener('load', ready);
