# DigiMenu Public — Müştərilərin QR skan edəndə gördüyü canlı menyu

## Quraşdırma
```
npm install
npm run dev
```

## Deploy (Vercel tövsiyə olunur, pulsuzdur)
```
npm install -g vercel
vercel
```
Domain bağlandıqdan sonra QR kodlar `https://digimenu.az/m/{slug}` formatında işləyəcək.

## Necə işləyir
- URL-dəki `slug` ilə Supabase-dən restoran tapılır (`businesses.slug`)
- O restoranın `menu_theme` sütununa görə 3 dizayndan biri göstərilir: `dark_glass`, `light_modern`, `warm_classic`
- Temayı mobil tətbiqdə (Profil → Menyu Dizaynı) sahibkar seçir, bura avtomatik tətbiq olunur
- Yalnız `is_published = true` olan restoranlar və `is_active = true` olan məhsullar göstərilir
