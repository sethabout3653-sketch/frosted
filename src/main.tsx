import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// This imported project is a plain React app. Keep one mounted tree so
// Firebase realtime listeners are not intentionally torn down and recreated
// by development-only StrictMode probing.
createRoot(document.getElementById('root')!).render(<App />);
