import type { Metadata } from 'next';
export const metadata: Metadata = {title:'Image Model Tester',description:'Compare image models with a workspace that follows your account.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
