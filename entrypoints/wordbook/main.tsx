import { createRoot } from 'react-dom/client';
import { Wordbook } from './Wordbook';
import '../../src/ui/floating.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<Wordbook />);
