import { createContext, useContext, useEffect, useState } from 'react';

// Text size scales the whole app: Tailwind sizes are in rem, so changing the
// root font size resizes text and spacing together. Saved per browser.
// eslint-disable-next-line react-refresh/only-export-components -- the options belong with the provider
export const TEXT_SIZES = [
    { id: 'small', label: 'Small', percent: 87.5 },
    { id: 'default', label: 'Default', percent: 100 },
    { id: 'large', label: 'Large', percent: 112.5 },
    { id: 'xlarge', label: 'Extra large', percent: 125 },
];
const STORAGE_KEY = 'crm.textSize';

function initialSize() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (TEXT_SIZES.some((s) => s.id === stored)) return stored;
    } catch { /* storage unavailable */ }
    return 'default';
}

const TextSizeContext = createContext();

export const TextSizeProvider = ({ children }) => {
    const [textSize, setTextSize] = useState(initialSize);

    useEffect(() => {
        const size = TEXT_SIZES.find((s) => s.id === textSize) || TEXT_SIZES[1];
        document.documentElement.style.fontSize = `${size.percent}%`;
        try { localStorage.setItem(STORAGE_KEY, size.id); } catch { /* storage unavailable */ }
    }, [textSize]);

    return (
        <TextSizeContext.Provider value={{ textSize, setTextSize }}>
            {children}
        </TextSizeContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export const useTextSize = () => useContext(TextSizeContext);
