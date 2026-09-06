import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Webpack owns the browser entry. Firebase remains the app's data store;
// keeping one React tree mounted preserves its realtime listeners.
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<App />);
