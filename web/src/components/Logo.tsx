import { memo } from "react";
import mark from "../assets/piastra-mark.svg?raw";

interface LogoProps {
	/** Rendered box size in px (the mark is square). */
	size?: number;
	className?: string;
}

/**
 * PiAstra mark, inlined so the glyph follows `currentColor` (light on the
 * dark shell, dark on light themes) while the red core keeps its own hue.
 */
export const Logo = memo(function Logo({ size = 20, className }: LogoProps) {
	return (
		<span
			className={`pi-mark${className ? ` ${className}` : ""}`}
			style={{ width: size, height: size }}
			aria-hidden="true"
			dangerouslySetInnerHTML={{ __html: mark }}
		/>
	);
});
