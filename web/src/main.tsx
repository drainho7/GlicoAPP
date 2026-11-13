import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Report, { isReportRoute } from './Report';
import './style.css';

createRoot(document.getElementById('root')!).render(isReportRoute() ? <Report /> : <App />);
