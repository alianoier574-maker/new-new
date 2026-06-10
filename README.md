# 🫏 مسابقه خرها - راهنمای نصب

## فایل‌ها
- `server.js` — سرور بازی (Node.js، بدون dependency خارجی)
- `index.html` — کلاینت بازی
- `install.sh` — اسکریپت نصب خودکار

---

## نصب سریع روی VPS

```bash
# آپلود فایل‌ها روی VPS
scp server.js index.html install.sh user@YOUR_VPS_IP:~/donkey-race/

# اتصال به VPS
ssh user@YOUR_VPS_IP

# اجرای اسکریپت نصب
chmod +x ~/donkey-race/install.sh
bash ~/donkey-race/install.sh
```

---

## اجرای دستی

```bash
cd ~/donkey-race
node server.js
# سرور روی پورت 3000 بالا میاد
```

### تغییر پورت
```bash
PORT=8080 node server.js
```

---

## اجرای همیشگی (pm2)

```bash
npm install -g pm2
pm2 start server.js --name donkey-race
pm2 save
pm2 startup   # کپی دستوری که نشون میده و اجرا کن
```

### دستورات pm2
```bash
pm2 status              # وضعیت
pm2 logs donkey-race    # لاگ‌ها
pm2 restart donkey-race # ریستارت
pm2 stop donkey-race    # متوقف کردن
```

---

## باز کردن پورت فایروال

```bash
# Ubuntu / Debian (ufw)
sudo ufw allow 3000

# CentOS / RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

---

## بازی کردن

1. لینک `http://YOUR_VPS_IP:3000` رو به دوستات بده
2. هر کسی اسم و اسکین خودش رو انتخاب میکنه
3. یه نفر دکمه «شروع مسابقه» رو میزنه
4. **سوایپ چپ/راست** = خر حرکت میکنه
5. هر چی سریع‌تر سوایپ کنی زودتر میرسی!

---

## قابلیت‌ها

- **مولتی‌پلیر واقعی** با WebSocket (بدون dependency)
- **۶ اسکین** متفاوت برای خر
- **زمین مسابقه** با جایگاه تماشاگر و خط پایان
- **سیستم جایزه** (سکه) بر اساس رتبه
- **کنترل سوایپ** برای موبایل + ماوس برای دسکتاپ
- **کانتداون** قبل از شروع
- **نمایش رتبه** در حین مسابقه
- **صفحه نتایج** با جوایز همه بازیکنان
- **Rematch** بعد از پایان مسابقه
