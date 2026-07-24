import type { Metadata } from "next"
import "./globals.css"
import localFont from "next/font/local"
import SiteHeader from "../components/SiteHeader"

// Use locally bundled Inter 300 to avoid Google Fonts CDN round-trip and eliminate layout shift
const inter = localFont({ src: "../../public/fonts/inter-300.woff", variable: "--font-sans", weight: "300" })

export const metadata: Metadata = {
	title: "steadyGray — Optical density equalisation for paragraphs | Type Tools",
	icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
	description: "steadyGray measures the actual ink density of each paragraph line using Canvas pixel sampling, then adjusts letter-spacing to bring all lines to the same optical grey. Zero required dependencies.",
	keywords: ["steadygray", "gray value", "optical density", "paragraph color", "letter spacing", "typography", "canvas pixel sampling", "typesetting", "readability", "TypeScript", "npm", "react"],
	openGraph: {
		title: "steadyGray — Optical density equalisation for paragraphs",
		description: "Equalize the visual grey of every paragraph line. Canvas pixel sampling, per-line letter-spacing correction. Zero required dependencies.",
		url: "https://steadygray.com",
		siteName: "steadyGray",
		type: "website",
		images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "steadyGray — Optical density equalisation for paragraphs" }],
	},
	twitter: {
		card: "summary_large_image",
		title: "steadyGray — Optical density equalisation for paragraphs",
		description: "Equalize the visual grey of every paragraph line. Canvas pixel sampling, per-line letter-spacing correction. Zero required dependencies.",
		site: "@liiift_studio",
		creator: "@liiift_studio",
	},
	metadataBase: new URL("https://steadygray.com"),
	alternates: { canonical: "https://steadygray.com" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`h-full antialiased ${inter.variable}`}>
			<body className="min-h-full flex flex-col">
				<SiteHeader current="steadyGray" githubUrl="https://github.com/Liiift-Studio/SteadyGray" />{children}</body>
		</html>
	)
}
