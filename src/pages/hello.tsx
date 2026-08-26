import { useState } from 'react'
export default function Hello() {
    const [n, setN] = useState(0)
    return (
        <button id="hello" onClick={() => setN((v) => v + 1)}>
            count:{n}
        </button>
    )
}
