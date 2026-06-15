import { createContext, useState } from "react";


export const AutoContext = createContext()

export const AuthProvider = ({ children }) => {
    
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)


    
    return (
        <AutoContext.Provider value={{ user, setUser, loading,setLoading }}>
            {children}
        </AutoContext.Provider>
    )
    
}