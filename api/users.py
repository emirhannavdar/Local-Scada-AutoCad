from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from api.auth import account_cursor,password_hash
import secrets
from api.authorization import EXTRA_PERMISSIONS

router=APIRouter()
class UserInput(BaseModel):
 username:str=Field(min_length=3,max_length=80,pattern=r'^[a-zA-Z0-9_.@-]+$')
 password:str|None=Field(default=None,min_length=12,max_length=128)
 role:str=Field(pattern=r'^(root|operator|viewer)$')
 permissions:list[str]=Field(default_factory=list,max_length=10)
 active:bool=True
 site_ids:list[int]=Field(default_factory=list,max_length=1000)

def root(request):
 if request.state.identity['role']!='root':raise HTTPException(403,'Kullanıcı yönetimi yalnızca root yetkisindedir.')

@router.get('')
def users(request:Request):
 root(request)
 with account_cursor() as c:
  c.execute('SELECT id,username,role,active,permissions FROM scada_user ORDER BY id')
  rows=[dict(zip(('id','username','role','active','permissions'),r)) for r in c.fetchall()]
  c.execute('SELECT user_id,site_id FROM scada_user_site');assignments=c.fetchall()
  for r in rows:r['site_ids']=[site for user,site in assignments if user==r['id']]
 return {'success':True,'data':rows}

def save(request,body,user_id=None):
 root(request)
 if set(body.permissions)-EXTRA_PERMISSIONS:raise HTTPException(422,'Bilinmeyen ek yetki.')
 if body.role!='operator' and body.permissions:raise HTTPException(422,'Ek yetkiler yalnızca operatöre verilebilir; izleyici salt okunurdur.')
 with account_cursor() as c:
  c.execute('SELECT pg_advisory_xact_lock(891231)')
  if user_id is not None:
   c.execute('SELECT role,active FROM scada_user WHERE id=%s FOR UPDATE',(user_id,));old=c.fetchone()
   if not old:raise HTTPException(404,'Kullanıcı bulunamadı.')
   if old==('root',True) and (body.role!='root' or not body.active):
    c.execute("SELECT count(*) FROM scada_user WHERE role='root' AND active AND id<>%s",(user_id,))
    if c.fetchone()[0]==0:raise HTTPException(409,'Son etkin root hesabı kapatılamaz veya yetkisi azaltılamaz.')
  elif not body.password:raise HTTPException(422,'Yeni kullanıcı için şifre gerekli.')
  ids=list(set(body.site_ids))
  c.execute('SELECT id FROM saha WHERE id=ANY(%s)',(ids,))
  if len(c.fetchall())!=len(ids):raise HTTPException(422,'Seçilen sahalardan biri bulunamadı.')
  c.execute('SELECT id FROM scada_user WHERE username=%s AND (%s::bigint IS NULL OR id<>%s)',(body.username,user_id,user_id))
  if c.fetchone():raise HTTPException(409,'Bu kullanıcı adı zaten kullanılıyor.')
  if body.password:
   salt=secrets.token_bytes(32);hashed=password_hash(body.password,salt)
  if user_id is None:
   c.execute('INSERT INTO scada_user(username,salt,password_hash,role,active,auth_version) VALUES(%s,%s,%s,%s,%s,%s) RETURNING id',(body.username,salt.hex(),hashed,body.role,body.active,secrets.randbits(30)+1));user_id=c.fetchone()[0]
  else:
   c.execute('UPDATE scada_user SET username=%s,role=%s,active=%s,auth_version=auth_version+1 WHERE id=%s',(body.username,body.role,body.active,user_id))
   if body.password:c.execute('UPDATE scada_user SET salt=%s,password_hash=%s WHERE id=%s',(salt.hex(),hashed,user_id))
  c.execute('UPDATE scada_user SET permissions=%s WHERE id=%s',(list(set(body.permissions)),user_id))
  c.execute('DELETE FROM scada_user_site WHERE user_id=%s',(user_id,))
  for site in ids:c.execute('INSERT INTO scada_user_site VALUES(%s,%s)',(user_id,site))
 return {'success':True,'data':{'id':user_id}}

@router.post('')
def create(body:UserInput,request:Request):return save(request,body)
@router.put('/{user_id}')
def update(user_id:int,body:UserInput,request:Request):return save(request,body,user_id)

@router.delete('/{user_id}')
def delete(user_id:int,request:Request):
 root(request)
 if request.state.identity.get('id')==user_id:raise HTTPException(409,'Kendi hesabını silemezsin.')
 with account_cursor() as c:
  c.execute('SELECT pg_advisory_xact_lock(891231)')
  c.execute('SELECT role,active FROM scada_user WHERE id=%s FOR UPDATE',(user_id,));old=c.fetchone()
  if not old:raise HTTPException(404,'Kullanıcı bulunamadı.')
  if old==('root',True):
   c.execute("SELECT count(*) FROM scada_user WHERE role='root' AND active AND id<>%s",(user_id,))
   if c.fetchone()[0]==0:raise HTTPException(409,'Son etkin root silinemez.')
  c.execute('DELETE FROM scada_user WHERE id=%s',(user_id,))
 return {'success':True,'data':{'id':user_id,'deleted':True}}
