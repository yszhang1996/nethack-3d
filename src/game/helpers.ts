export function getItemTextClassName(text: string): string {
    const isBlessed = /\bblessed\b/.test(text);
    const isCursed = /\bcursed\b/.test(text);

    let className = "nh3d-inventory-text";
    if (isBlessed) {
        className += " blessed-text";
    } else if (isCursed) {
        className += " cursed-text";
    }

    return className;
}
