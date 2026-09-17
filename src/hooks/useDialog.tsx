import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import DialogView, { type ConfirmOptions, type DialogRequest, type PromptOptions } from '../components/dialog'

/**
 * In-app replacements for window.confirm and window.prompt. The native ones
 * are unreliable where members actually are: embedded browsers and some
 * installed web apps block them, and a blocked confirm reads as "cancel", so
 * the action silently does nothing. Render `element` somewhere in the page.
 */
export function useDialog() {
    const [request, setRequest] = useState<DialogRequest | null>(null)

    const confirm = useCallback(
        (options: ConfirmOptions) =>
            new Promise<boolean>((resolve) =>
                setRequest({ kind: 'confirm', ...options, resolve: (value) => resolve(value !== null) })
            ),
        []
    )

    const prompt = useCallback(
        (options: PromptOptions) =>
            new Promise<string | null>((resolve) => setRequest({ kind: 'prompt', ...options, resolve })),
        []
    )

    // Stable per request, so the dialog's focus effect runs once, not per keystroke.
    const close = useCallback(
        (value: string | null) => {
            request?.resolve(value)
            setRequest(null)
        },
        [request]
    )

    // Portalled to <body> so no page container can clip or restack it.
    const element = request ? createPortal(<DialogView request={request} onClose={close} />, document.body) : null

    return { confirm, prompt, element }
}
