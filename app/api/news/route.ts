import { NextResponse } from 'next/server';
import editorialNews from '@/content/news.json';

export const dynamic = 'force-dynamic';

interface EditorialNewsItem {
  id: string;
  title: string;
  body?: string;
  url?: string;
}

export async function GET() {
  const isProduction = process.env.VERCEL_ENV === 'production';

  if (!isProduction) {
    return NextResponse.json(
      { available: false, items: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const authoredItems = (editorialNews as EditorialNewsItem[]).slice(0, 20).map((item) => ({
    id: `news:${item.id}`,
    type: 'news' as const,
    title: item.title,
    body: item.body ?? null,
    url: item.url ?? null,
  }));

  return NextResponse.json(
    {
      available: true,
      items: authoredItems,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
