import { createContext, useContext, useState } from 'react';

const TextSizeContext = createContext();

export const TextSizeProvider = ({ children }) => {
    const [textSize, setTextSize] = useState(14);
    return (
        <TextSizeContext.Provider  value={{ textSize, setTextSize }}>
            {children}
        </TextSizeContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export const useTextSize = () => useContext(TextSizeContext);
