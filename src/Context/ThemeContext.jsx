import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();
const STORAGE_KEY = 'crm.theme';

function getInitialTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(getInitialTheme);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);
    }, [theme]);

    const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);

// Chart libraries (recharts) set colors via JS props on SVG elements, not
// Tailwind classNames — the global CSS override layer in index.css can't
// reach them at all. Every chart in the app hardcoded the same handful of
// dark-mode-only hex values (axis/grid gray, tooltip background), so this
// gives them one theme-aware source instead of hardcoding twice.
const CHART_COLORS = {
    dark: { grid: '#374151', tick: '#9ca3af', tooltipBg: '#111827', tooltipBorder: '#374151', cursorFill: '#1f2937' },
    light: { grid: '#E2E4E6', tick: '#4E525A', tooltipBg: '#FFFFFF', tooltipBorder: '#D2D5D9', cursorFill: '#F1F3F5' },
};

export const useChartColors = () => {
    const { theme } = useTheme();
    return CHART_COLORS[theme] || CHART_COLORS.dark;
};
