import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import RegisterSW from "@/components/RegisterSW";
import AuthGate from "@/components/AuthGate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Remote SSH",
  description: "Mobile SSH terminal & Claude CLI remote control",
  applicationName: "Remote SSH",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Remote SSH",
  },
  // Điện thoại hiện số trong tin nhắn/địa chỉ thành link gọi, làm vỡ layout terminal.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
  ],
};

const themeInit = `(function(){try{var t=localStorage.getItem("remote-ssh.theme");if(!t){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthGate>{children}</AuthGate>
        <RegisterSW />
      </body>
    </html>
  );
}
