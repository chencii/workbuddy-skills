#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
课表 → 交互检查器 HTML 生成器（固化 Skill：schedule-checker-builder）
=====================================================================
从「班级课表 xlsx + 教师名单 xlsx」生成单文件交互式课表检查器 HTML：
  - 下拉选教师 → 一键高亮该教师全部课节（#A9BA9D）+ 周课表摘要
  - 【修改】↔【保存】：两击交换/拖拽换位；每格右缘是当日换课侧栏，点条目可落到任意格；交换前自动检查全部硬约束
  - 【检查硬约束】：全量检查，违规格子红框 + 违规清单

用法:
  python3 build_checker.py --schedule 课表.xlsx --teachers 名单.xlsx [--out 输出目录] \
      [--title "标题"] [--verify] [--edge "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]

说明:
  - 课表.xlsx: 每个班级一个 sheet（sheet 名=班级号，如 2601），行=时段（早读/第1节/.../夜自习），
    列=周一~五，格子内容 "科目\n教师"
  - 名单.xlsx: 第一行为表头（科目 列 × 班级列），含"班主任"行、"班型"行
  - --verify: 用 Edge headless 运行自动测试页（初始0违规+教师冲突检出），验证产物正确
"""
import argparse
import json
import os
import re
import subprocess
import sys

import openpyxl

# ==================== 配置区（按年级/课时需求调整）====================
# 每班每周课时需求: 科目 -> (正课, 自习)
DEFAULT_HOURS = {
    '语文': (5, 2), '数学': (6, 2), '英语': (5, 2),
    '物理': (4, 2), '化学': (3, 2), '生物': (3, 2),
    '政治': (2, 1), '历史': (2, 2), '地理': (2, 2),
    '体育': (2, 0), '艺术': (1, 0), '信息/心理': (1, 0),
}
NINE = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理']  # 9大科目(有自习)
SLOT_NAMES = ['早读', '第1节', '第2节', '学科自习', '第4节', '第5节', '第6节', '第7节', '第8节', '第9节', '晚自习1', '晚自习2', '夜自习']
SLOT_TIMES = ['7:20-7:40', '7:50-8:30', '8:40-9:20', '9:50-10:30', '10:40-11:20', '11:30-12:10',
              '14:30-15:10', '15:20-16:00', '16:10-16:50', '17:05-17:45', '18:40-19:20', '19:30-20:10', '20:25-22:10']

# 槽位模型（v21）: 第3节/晚自习1/晚自习2 固定自习位；周二(1)、周五(4) 第8/9节一自习一正课（动态）
# 周一(0)第9=班会、周三(2)第9=公共自习、周四(3)第8/9=正课、周一三(0,2)第8=正课
# ==================== 配置区结束 ====================


def load_schedule(path):
    """读课表：sheet 名=班级，行5起为13时段，列3-7为周一~五"""
    wb = openpyxl.load_workbook(path, data_only=True)
    classes = [sn for sn in wb.sheetnames if re.fullmatch(r'\d{3,4}', str(sn))]
    if not classes:
        classes = wb.sheetnames  # 兜底：全部 sheet 视为班级
    data = {}
    for c in classes:
        ws = wb[c]
        data[c] = {}
        for d in range(5):
            data[c][d] = {}
            for i, sn in enumerate(SLOT_NAMES):
                v = ws.cell(row=5 + i, column=3 + d).value
                if not v:
                    data[c][d][i] = {'subj': '', 'teacher': ''}
                elif sn == '早读':
                    data[c][d][i] = {'subj': str(v).replace('早读·', ''), 'teacher': ''}
                else:
                    p = str(v).split('\n')
                    data[c][d][i] = {'subj': p[0].strip(), 'teacher': p[1].strip() if len(p) > 1 else ''}
    return classes, data


def load_teachers(path, classes, data=None):
    """读名单：找含"科目"的表头行，科目×班级→教师；班主任行。
    path 为 None 时从课表数据自动提取教师（教师下拉仍可用，无班主任标记）"""
    if path is None:
        # 从课表自动提取：遍历所有格子，收集 (科目, 教师) 对
        teacher_info = {}
        for c in classes:
            for d in range(5):
                for s in range(1, 12):
                    cell = data[c][d][s]
                    if cell['teacher'] and cell['subj']:
                        t = cell['teacher']
                        info = teacher_info.setdefault(t, {'subj': cell['subj'], 'classes': []})
                        if c not in info['classes']:
                            info['classes'].append(c)
        return teacher_info, []
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = None
    for name in wb.sheetnames:
        for row in wb[name].iter_rows(min_row=1, max_row=40, values_only=True):
            if row and row[0] == '科目':
                ws = wb[name]
                break
        if ws:
            break
    if ws is None:
        raise RuntimeError(f'名单文件 {path} 中未找到"科目"表头')
    rows = list(ws.iter_rows(values_only=True))
    hr = next(i for i, r in enumerate(rows) if r and r[0] == '科目')
    header = rows[hr]
    tclasses = [str(c) for c in header[1:] if c and str(c).startswith(str(classes[0])[:2])]
    if not tclasses:
        tclasses = [str(c) for c in header[1:] if c]
    teacher_info = {}
    bzr = []
    for row in rows[hr + 1:]:
        if not row or row[0] is None:
            continue
        key = str(row[0]).strip()
        for j, cls in enumerate(tclasses):
            v = row[j + 1] if j + 1 < len(row) else None
            if v is None:
                continue
            t = str(v).strip()
            if key == '班主任':
                if t and t not in bzr:
                    bzr.append(t)
            elif key == '班型':
                continue
            else:
                teacher_info.setdefault(t, {'subj': key, 'classes': []})['classes'].append(cls)
    return teacher_info, bzr


def fixed_lt(c, d, s):
    # v48：第8节恒正课（周四五除外·动态）；周二第9节正课（补总量36）；周四五第8/9节动态
    if s == 0 or s == 12:
        return 'N'
    if d == 0 and s == 9:
        return 'N'          # 班会
    if d == 2 and s == 9:
        return 'N'          # 公共自习
    if s in (1, 2, 4, 5, 6, 7):
        return 'L'
    if s in (3, 10, 11):
        return 'S'
    if s == 8:
        return '?' if d in (3, 4) else 'L'
    if s == 9:
        if d == 1:
            return 'L'      # 周二第9节正课
        if d in (3, 4):
            return '?'      # 动态
        return 'N'
    return '?'


def resolve_dyn(c, data, hours):
    """暴力枚举周四(3)、周五(4) 4个动态格（8/9节）的正课/自习位组合"""
    dyn_cells = [(3, 8), (3, 9), (4, 8), (4, 9)]
    for mask in range(16):
        cand, ok = {}, True
        per_day_self = {3: 0, 4: 0}
        nl, ns = {}, {}
        for d in range(5):
            for s in range(1, 12):
                subj = data[c][d][s]['subj']
                if not subj:
                    continue
                if (d, s) in dyn_cells:
                    lt2 = 'S' if (mask >> dyn_cells.index((d, s))) & 1 else 'L'
                    cand[(d, s)] = lt2
                else:
                    lt2 = fixed_lt(c, d, s)
                if lt2 == 'L':
                    nl[subj] = nl.get(subj, 0) + 1
                elif lt2 == 'S':
                    ns[subj] = ns.get(subj, 0) + 1
                    if (d, s) in dyn_cells:
                        per_day_self[d] += 1
        for subj, (a, b) in hours.items():
            if nl.get(subj, 0) != a or ns.get(subj, 0) != b:
                ok = False
                break
        if ok and per_day_self[3] == 1 and per_day_self[4] == 1:
            return cand
    return None


def compute_lt(classes, data, hours):
    lt = {}
    unresolved = []
    for c in classes:
        cand = resolve_dyn(c, data, hours)
        if cand is None:
            unresolved.append(c)
        for d in range(5):
            for s in range(13):
                if (d, s) in cand:
                    lt[(c, d, s)] = cand[(d, s)]
                else:
                    lt[(c, d, s)] = fixed_lt(c, d, s)
    return lt, unresolved


# ==================== 模板（由 skill 组装时注入，勿手改） ====================
ENGINE_TEMPLATE = r"""// 硬约束检查引擎（纯逻辑，无 DOM 依赖）
var CLASSES = SCHED_DATA.classes, DAYS = SCHED_DATA.days, SLOTS = SCHED_DATA.slots;
var S = SCHED_DATA.data;   // S[cls][day][slot] = {s:科目, t:教师, lt:'L'正课位/'S'自习位/'N'不计}

var NINE = ['语文','数学','英语','物理','化学','生物','政治','历史','地理'];
var SUBJ_HOURS = {'语文':[5,2],'数学':[6,2],'英语':[5,2],'物理':[4,2],'化学':[3,2],'生物':[3,2],
                  '政治':[2,1],'历史':[2,2],'地理':[2,2],'体育':[2,0],'艺术':[1,0],'信息/心理':[1,0]};
var AM = [1,2,3,4,5], PM = [6,7,8,9,10,11];

function isLocked(c,d,s){ return (s===0||s===12||(d===0&&s===9)||(d===2&&s===9)); }
function sName(s){ return SLOTS[s].name+'节'; }
function teacherOf(c,subj){ for(var d=0;d<5;d++) for(var s=1;s<12;s++) if(S[c][d][s].s===subj) return S[c][d][s].t; return ''; }
function pairOf(c,subj){
  for(var d=0;d<5;d++){
    var pairs = [[1,2],[4,5],[6,7]];
    for(var i=0;i<pairs.length;i++){ var a=pairs[i][0], b=pairs[i][1];
      if(S[c][d][a].s===subj&&S[c][d][b].s===subj) return {day:d, half:(a<=5?'上午':'下午')}; }
    if(S[c][d][7].s===subj&&S[c][d][8].s===subj&&S[c][d][8].lt==='L') return {day:d, half:'下午'};
  }
  return null;
}
function buildTeacherMap(){
  var tSubj = {}, tCls = {};
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++) for(var s=1;s<12;s++){
      var t = S[c][d][s].t, subj = S[c][d][s].s;
      if(t){
        if(subj==='语文'||subj==='数学'){ tSubj[t]=subj; if(!tCls[t]) tCls[t]=[]; if(tCls[t].indexOf(c)<0) tCls[t].push(c); }
        else if(!tSubj[t]) tSubj[t]=subj;
      }
    }
  }
  return {tSubj:tSubj, tCls:tCls};
}

function checkAll(){
  var viol = [], T = buildTeacherMap();
  // H1 锁定
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++) for(var s=0;s<13;s++){
      var cell = S[c][d][s];
      if(isLocked(c,d,s)){
        if(s===12 && cell.s) viol.push({name:'H1 夜自习必须为空', msg:c+' '+DAYS[d]+' 夜自习被占用: '+cell.s, cells:[[c,d,s]]});
        if(s===9&&d===0 && cell.s!=='班会') viol.push({name:'H1 班会锁定', msg:c+' 周一第9节应为班会', cells:[[c,d,s]]});
        if(s===9&&d===2 && cell.s!=='公共自习'&&cell.s!=='') viol.push({name:'H1 公共自习锁定', msg:c+' 周三第9节应为公共自习', cells:[[c,d,s]]});
      } else {
        if(cell.s==='班会'||cell.s==='公共自习') viol.push({name:'H1 班会/公共自习只能在锁定位置', msg:c+' '+DAYS[d]+sName(s)+' 出现'+cell.s, cells:[[c,d,s]]});
      }
    }
  }
  // H2 早读绑定
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++){
      var expect = (d%2===0)?'语文':'英语';
      if(S[c][d][0].s !== expect)
        viol.push({name:'H2 早读绑定', msg:c+' '+DAYS[d]+' 早读应为'+expect+'，实际:'+(S[c][d][0].s||'空'), cells:[[c,d,0]]});
    }
  }
  // H6 教师冲突
  var tmap = {};
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++) for(var s=1;s<12;s++){
      var t = S[c][d][s].t;
      if(t){ var k=t+'\u0000'+d+'\u0000'+s; if(!tmap[k]) tmap[k]=[]; tmap[k].push(c); }
    }
  }
  for(var k in tmap) if(tmap[k].length>1){
    var ks=k.split('\u0000');
    viol.push({name:'H6 教师冲突', msg:ks[0]+' '+DAYS[+ks[1]]+' '+sName(+ks[2])+' 同时出现在 '+tmap[k].join('、')+' 班', cells:tmap[k].map(function(c){return [c,+ks[1],+ks[2]];})});
  }
  // H3 课时总量 + 正课/自习槽位精确
  for(var subj in SUBJ_HOURS){
    var a=SUBJ_HOURS[subj][0], b=SUBJ_HOURS[subj][1];
    for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
      var total=0, nl=0, ns=0;
      for(var d=0;d<5;d++) for(var s=1;s<12;s++){
        if(S[c][d][s].s===subj){
          total++;
          if(S[c][d][s].lt==='L') nl++;
          else if(S[c][d][s].lt==='S') ns++;
        }
      }
      if(total!==a+b) viol.push({name:'H3 课时总量', msg:c+' '+subj+' 应为'+(a+b)+'节，实际'+total+'节', cells:null});
      if(nl!==a) viol.push({name:'H3 正课槽位', msg:c+' '+subj+' 在正课位'+nl+'节（应'+a+'节），有正课被排入自习位', cells:null});
      if(ns!==b) viol.push({name:'H3 自习槽位', msg:c+' '+subj+' 在自习位'+ns+'节（应'+b+'节）', cells:null});
    }
  }
  // H5 自习位必须9大科目
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++) for(var s=1;s<12;s++){
      if(S[c][d][s].lt==='S' && S[c][d][s].s && NINE.indexOf(S[c][d][s].s)<0)
        viol.push({name:'H5 自习位必须9大科目', msg:c+' '+DAYS[d]+' '+sName(s)+' 是'+S[c][d][s].s, cells:[[c,d,s]]});
    }
  }
  // H7 连排（语文/数学各恰1对）
  var pairSubj = ['语文','数学'];
  for(var pi=0;pi<pairSubj.length;pi++){ var psubj=pairSubj[pi];
    for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
      var np=0;
      for(var d=0;d<5;d++){
        var pairs = [[1,2],[4,5],[6,7]];
        for(var i=0;i<pairs.length;i++){ var a=pairs[i][0], bb=pairs[i][1];
          if(S[c][d][a].s===psubj && S[c][d][bb].s===psubj && S[c][d][a].lt==='L' && S[c][d][bb].lt==='L') np++; }
        if(S[c][d][7].s===psubj && S[c][d][8].s===psubj && S[c][d][8].lt==='L') np++;
        if(psubj==='数学' && d===3 && S[c][3][8].s==='数学' && S[c][3][9].s==='数学' && S[c][3][9].lt==='L') np++;  // (8,9) 周四数学连排
      }
      if(np!==1) viol.push({name:'H7 连排恰1对', msg:c+' '+psubj+' 连排'+np+'对（应为1对）', cells:null});
    }
  }
  // H18 两班连排同日同半天
  for(var t in T.tCls){
    if(T.tCls[t].length!==2) continue;
    var subj = T.tSubj[t];
    if(subj!=='语文'&&subj!=='数学') continue;
    var pd1 = pairOf(T.tCls[t][0],subj), pd2 = pairOf(T.tCls[t][1],subj);
    if(pd1 && pd2 && (pd1.day!==pd2.day || pd1.half!==pd2.half))
      viol.push({name:'H18 两班连排同日同半天', msg:t+' '+T.tCls[t][0]+'连排'+DAYS[pd1.day]+pd1.half+' vs '+T.tCls[t][1]+'连排'+DAYS[pd2.day]+pd2.half, cells:null});
  }
  // H11 语数外半天制
  var half3 = ['语文','数学','英语'];
  for(var hi=0;hi<half3.length;hi++){ var hsubj=half3[hi];
    for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
      for(var d=0;d<5;d++){
        var am=0, pm=0;
        for(var ai=0;ai<AM.length;ai++) if(S[c][d][AM[ai]].s===hsubj) am++;
        for(var ai=0;ai<PM.length;ai++) if(S[c][d][PM[ai]].s===hsubj) pm++;
        if(am>0&&pm>0) viol.push({name:'H11 语数外半天制', msg:c+' '+DAYS[d]+' '+hsubj+' 上午'+am+'节+下午'+pm+'节', cells:null});
      }
    }
  }
  // H14 语文分布（正课位）
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    var perDay=[];
    for(var d=0;d<5;d++){
      var n=0;
      for(var s=1;s<12;s++) if(S[c][d][s].s==='语文'&&S[c][d][s].lt==='L') n++;
      perDay.push(n);
    }
    var sorted=perDay.slice().sort();
    if(sorted.join()!=='0,1,1,1,2') viol.push({name:'H14 语文分布', msg:c+' 语文正课每天['+perDay.join(',')+']', cells:null});
  }
  // H15 英语每天1节
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++){
      var n=0;
      for(var s=1;s<12;s++) if(S[c][d][s].s==='英语'&&S[c][d][s].lt==='L') n++;
      if(n!==1) viol.push({name:'H15 英语每天1节', msg:c+' '+DAYS[d]+' 英语正课'+n+'节', cells:null});
    }
  }
  // H19 数学分布
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    var perDay=[];
    for(var d=0;d<5;d++){
      var n=0;
      for(var s=1;s<12;s++) if(S[c][d][s].s==='数学'&&S[c][d][s].lt==='L') n++;
      perDay.push(n);
    }
    var bad=false, two=0;
    for(var i=0;i<5;i++){ if(perDay[i]<1||perDay[i]>2) bad=true; if(perDay[i]===2) two++; }
    if(bad||two!==1) viol.push({name:'H19 数学分布', msg:c+' 数学正课每天['+perDay.join(',')+']', cells:null});
  }
  // H20 小科每天≤1
  var small6 = ['物理','化学','生物','政治','历史','地理'];
  for(var si2=0;si2<small6.length;si2++){ var ssubj=small6[si2];
    for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
      for(var d=0;d<5;d++){
        var n=0;
        for(var s=1;s<12;s++) if(S[c][d][s].s===ssubj&&S[c][d][s].lt==='L') n++;
        if(n>1) viol.push({name:'H20 小科每天≤1', msg:c+' '+DAYS[d]+' '+ssubj+'正课'+n+'节', cells:null});
      }
    }
  }
  // H8 体育
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++) for(var s=1;s<12;s++){
      if(S[c][d][s].s!=='体育') continue;
      if(d!==1&&d!==4) viol.push({name:'H8 体育只在周二五', msg:c+' '+DAYS[d]+sName(s)+' 有体育', cells:[[c,d,s]]});
      if(s<4||s>8) viol.push({name:'H8 体育只排4-8节', msg:c+' '+DAYS[d]+sName(s)+' 有体育', cells:[[c,d,s]]});
    }
  }
  for(var d=0;d<5;d++) for(var s=4;s<=8;s++){
    var cnt=[]; for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci]; if(S[c][d][s].s==='体育') cnt.push(c); }
    if(cnt.length>4||cnt.length%2!==0) viol.push({name:'H8 体育每时段≤4且偶数', msg:DAYS[d]+sName(s)+' 体育班数'+cnt.length, cells:cnt.map(function(c){return [c,d,s];})});
  }
  // H9 艺术/体育/信息不排前两节
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var d=0;d<5;d++) for(var si=0;si<2;si++){ var s=si+1;
      var subj=S[c][d][s].s;
      if(subj==='体育'||subj==='艺术'||subj==='信息/心理') viol.push({name:'H9 小科不排前两节', msg:c+' '+DAYS[d]+sName(s)+' 是'+subj, cells:[[c,d,s]]});
    }
  }
  // H12/H13 语英错峰
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var di=0;di<3;di++){ var d=[0,2,4][di]; for(var s=1;s<=5;s++) if(S[c][d][s].s==='英语')
      viol.push({name:'H12 语英错峰', msg:c+' '+DAYS[d]+sName(s)+' 有英语', cells:[[c,d,s]]}); }
    for(var di=0;di<2;di++){ var d=[1,3][di]; for(var s=1;s<=5;s++) if(S[c][d][s].s==='语文')
      viol.push({name:'H13 语英错峰', msg:c+' '+DAYS[d]+sName(s)+' 有语文', cells:[[c,d,s]]}); }
  }
  // H22 物理
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    var thu=0;
    for(var s=6;s<=9;s++) if(S[c][3][s].s==='物理'&&S[c][3][s].lt==='L') thu++;
    if(thu!==1) viol.push({name:'H22 物理周四1节', msg:c+' 周四下午物理正课'+thu+'节', cells:null});
    var off=0;
    for(var d=0;d<5;d++){ var has=false; for(var s=1;s<12;s++) if(S[c][d][s].s==='物理') has=true; if(!has) off++; }
    if(off!==1) viol.push({name:'H22 物理恰1天无课', msg:c+' 物理无课日'+off+'天', cells:null});
  }
  var physDays = {}, physOff = {};
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    var t = teacherOf(c,'物理');
    if(t){ if(!physDays[t]) physDays[t]=[]; physDays[t].push(c); }
    var offs=[];
    for(var d=0;d<5;d++){ var has=false; for(var s=1;s<12;s++) if(S[c][d][s].s==='物理') has=true; if(!has) offs.push(d); }
    physOff[c]=offs;
  }
  for(var t in physDays){
    if(physDays[t].length<2) continue;
    var sets = physDays[t].map(function(c){ return JSON.stringify(physOff[c]); });
    if(new Set(sets).size>1) viol.push({name:'H22 物理教师无课日一致', msg:t+' 班级无课日不同', cells:null});
  }
  // H31 自习与正课同半天（班级视角：自习不得跨到另一个半天）
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var si2=0;si2<NINE.length;si2++){ var hsubj=NINE[si2];
      for(var d=0;d<5;d++){
        var amL=0, amS=0, pmL=0, pmS=0;
        for(var s=1;s<12;s++){
          if(S[c][d][s].s!==hsubj) continue;
          if(s<=5){ if(S[c][d][s].lt==='L') amL++; else amS++; }
          else   { if(S[c][d][s].lt==='L') pmL++; else pmS++; }
        }
        if(amL>0&&pmS>0) viol.push({name:'H31 自习与正课同半天', msg:c+' '+DAYS[d]+' '+hsubj+' 上午正课但下午/晚上有自习', cells:null});
        if(pmL>0&&amS>0) viol.push({name:'H31 自习与正课同半天', msg:c+' '+DAYS[d]+' '+hsubj+' 下午正课但上午第3节有自习', cells:null});
      }
    }
  }

  // ===== 教师个性化/新增强硬约束（与模型一致，2026-08-26 v46 更新）=====
  // C11 闫海香（数学2614，硬）：①不看晚自习（10/11节无数学）②周一到四至少3天上午有数学正课
  if(CLASSES.indexOf('2614')>=0){
    var c='2614';
    var amDays=0;
    for(var d=0;d<4;d++) for(var si=0;si<4;si++){ var s=[1,2,4,5][si];
      if(S[c][d][s].s==='数学'&&S[c][d][s].lt==='L'){ amDays++; break; } }
    if(amDays<3) viol.push({name:'C11 闫海香周一到四≥3天上午', msg:'2614 周一到四上午数学天数='+amDays, cells:null});
    for(var d=0;d<5;d++) for(var si=0;si<2;si++){ var s=[10,11][si];
      if(S[c][d][s].s==='数学') viol.push({name:'C11 闫海香不看晚自习', msg:'2614 '+DAYS[d]+sName(s)+' 有数学', cells:[[c,d,s]]}); }
  }
  // H25 王老师周五上午（硬）：王老师所带班(2602/2604)周五数学正课只在上午[1,2,4,5]
  if(CLASSES.indexOf('2602')>=0){
    var cs=['2602','2604'];
    for(var ci=0;ci<cs.length;ci++) for(var si=0;si<4;si++){ var s=[6,7,8,9][si];
      if(S[cs[ci]][4][s].s==='数学') viol.push({name:'H25 王老师周五上午', msg:cs[ci]+' 周五'+sName(s)+'有数学(应在上午)', cells:[[cs[ci],4,s]]}); }
  }
  // H24 六条空出规矩（硬，用户指定 H24 不能动）+ 周二全校无语文
  // 周一上午无物理/历史、周一下午无语文；周二上午无化学/政治、周二下午无数学；
  // 周四上午无生物/地理、周四下午无英语
  var H24MAP = {0:{am:['物理','历史'],pm:['语文']},1:{am:['化学','政治'],pm:['数学']},3:{am:['生物','地理'],pm:['英语']}};
  for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
    for(var dd in H24MAP){ var day=parseInt(dd);
      var ams=H24MAP[dd].am, pms=H24MAP[dd].pm;
      for(var ai=0;ai<ams.length;ai++){ var subj=ams[ai];
        for(var si=0;si<4;si++){ var s=[1,2,4,5][si];
          if(S[c][day][s].s===subj) viol.push({name:'H24 六条空出规矩', msg:c+' '+DAYS[day]+sName(s)+' 有'+subj, cells:[[c,day,s]]}); } }
      for(var ai=0;ai<pms.length;ai++){ var subj=pms[ai];
        for(var si=0;si<4;si++){ var s=[6,7,8,9][si];
          if(S[c][day][s].s===subj) viol.push({name:'H24 六条空出规矩', msg:c+' '+DAYS[day]+sName(s)+' 有'+subj, cells:[[c,day,s]]}); } }
    }
    for(var s=1;s<12;s++) if(S[c][1][s].s==='语文') viol.push({name:'H24 周二全校无语文', msg:c+' 周二'+sName(s)+' 有语文', cells:[[c,1,s]]});
  }
  // H26 晚自习值班天数（硬）：闫海香/王艳萍/李政/冯治平 0天；王树花恰1天；其余≤2天
  var eveDaysN={};
  for(var t in T.tCls){
    var ds={};
    for(var ci=0;ci<T.tCls[t].length;ci++) for(var d=0;d<5;d++) for(var si=0;si<2;si++){ var s=[10,11][si];
      if(S[T.tCls[t][ci]][d][s].t===t) ds[d]=true; }
    if(Object.keys(ds).length>0) eveDaysN[t]=Object.keys(ds).length;
  }
  for(var t in eveDaysN){
    var n=eveDaysN[t];
    if(t==='闫海香'||t==='王艳萍'||t==='李政'||t==='冯治平'){ if(n>0) viol.push({name:'H26 晚自习值班天数', msg:t+' 值班'+n+'天(应0天)', cells:null}); }
    else if(t==='王树花'){ if(n!==1) viol.push({name:'H26 晚自习值班天数', msg:'王树花 值班'+n+'天(应恰1天)', cells:null}); }
    else if(n>2) viol.push({name:'H26 晚自习值班天数', msg:t+' 值班'+n+'天(应≤2天)', cells:null});
  }
  // H30 每晚在岗老师恰18人（硬）
  for(var d=0;d<5;d++){
    var names={};
    for(var ci=0;ci<CLASSES.length;ci++){ var c=CLASSES[ci];
      for(var si=0;si<2;si++){ var s=[10,11][si];
        if(S[c][d][s].t) names[S[c][d][s].t]=true; } }
    var n=Object.keys(names).length;
    if(n!==18) viol.push({name:'H30 每晚在岗18人', msg:DAYS[d]+' 晚自习在岗'+n+'人(应18人)', cells:null});
  }
  // C19d 贾然每周晚自习恰 1 天（硬，2026-08-27）
  if(T.tCls['贾然']){
    var jd=0;
    for(var d=0;d<5;d++) for(var si=0;si<2;si++){ var s=[10,11][si];
      for(var ci=0;ci<T.tCls['贾然'].length;ci++) if(S[T.tCls['贾然'][ci]][d][s].t==='贾然'){ jd|=1<<d; break; } }
    var jn=[jd&1,(jd>>1)&1,(jd>>2)&1,(jd>>3)&1,(jd>>4)&1].reduce(function(a,b){return a+b;},0);
    if(jn!==1) viol.push({name:'C19d 贾然晚自习恰1天', msg:'贾然 晚自习'+jn+'天(应恰好1天)', cells:null});
  }
  // C18 老师"上午第4/5节"次数：非数学 多班≤3/单班≤4（硬，2026-08-27；数学豁免仅软引导）
  for(var t in T.tCls){
    if(T.tSubj[t]==='数学') continue;
    var cnt45=0;
    for(var ci=0;ci<T.tCls[t].length;ci++){ var c=T.tCls[t][ci];
      for(var d=0;d<5;d++) for(var si=0;si<2;si++){ var s=[4,5][si];
        if(S[c][d][s].t===t) cnt45++; } }
    var lim=(T.tCls[t].length===1)?4:3;
    if(cnt45>lim) viol.push({name:'C18 第4/5节次数', msg:t+' 上午第4/5节共'+cnt45+'次(限≤'+lim+')',
      cells:(function(){var cs=[];for(var ci=0;ci<T.tCls[t].length;ci++){var c=T.tCls[t][ci];for(var d=0;d<5;d++)for(var si=0;si<2;si++){var s=[4,5][si];if(S[c][d][s].t===t)cs.push([c,d,s]);}}return cs;}())});
  }
  // H21 数学老师半天制
  for(var t in T.tCls){
    if(T.tSubj[t]!=='数学') continue;
    for(var d=0;d<5;d++){
      var am=0,pm=0;
      for(var ci=0;ci<T.tCls[t].length;ci++){ var c=T.tCls[t][ci];
        for(var ai=0;ai<AM.length;ai++) if(S[c][d][AM[ai]].s==='数学') am++;
        for(var ai=0;ai<PM.length;ai++) if(S[c][d][PM[ai]].s==='数学') pm++; }
      if(am>0&&pm>0) viol.push({name:'H21 数学老师半天制', msg:t+' '+DAYS[d]+' 数学跨上午'+am+'节+下午'+pm+'节', cells:null});
    }
  }
  return viol;
}

// 尝试交换两格：返回 {ok, viol}
function trySwap(c1,d1,s1,c2,d2,s2){
  var a = S[c1][d1][s1], b = S[c2][d2][s2];
  var sa = {s:a.s, t:a.t, lt:a.lt}, sb = {s:b.s, t:b.t, lt:b.lt};
  a.s=b.s; a.t=b.t; a.lt=b.lt; b.s=sa.s; b.t=sa.t; b.lt=sa.lt;
  var viol = checkAll();
  if(viol.length){ a.s=sa.s; a.t=sa.t; a.lt=sa.lt; b.s=sb.s; b.t=sb.t; b.lt=sb.lt; return {ok:false, viol:viol}; }
  return {ok:true, viol:[]};
}"""
UI_HEAD_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__</title>
<style>
  :root { --hl:#A9BA9D; --err:#E57373; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:"PingFang SC","Microsoft YaHei",sans-serif; background:#F5F6F8; color:#333; padding:12px; }
  h1 { font-size:18px; margin-bottom:4px; }
  .sub { font-size:12px; color:#888; margin-bottom:10px; }
  .toolbar { background:#fff; border:1px solid #ddd; border-radius:8px; padding:10px 14px;
             display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:10px;
             position:sticky; top:0; z-index:50; box-shadow:0 2px 6px rgba(0,0,0,.06); }
  .toolbar label { font-size:13px; color:#555; }
  select { font-size:13px; padding:4px 8px; border:1px solid #bbb; border-radius:5px; background:#fff; max-width:220px; }
  button { font-size:13px; padding:6px 16px; border:none; border-radius:6px; cursor:pointer; font-weight:600; }
  #btnEdit { background:#4C6EF5; color:#fff; }
  #btnEdit.on { background:#F59F00; }
  #btnCheck { background:#fff; border:1px solid #4C6EF5; color:#4C6EF5; }
  .stat { font-size:12px; color:#666; }
  .badge { display:inline-block; padding:1px 10px; border-radius:10px; font-size:12px; margin-left:4px; }
  .badge.ok { background:#E8F5E9; color:#2E7D32; }
  .badge.err { background:#FFEBEE; color:#C62828; }
  .summary { font-size:12px; color:#555; background:#F8F9FA; border:1px dashed #ccc;
             border-radius:6px; padding:6px 10px; display:none; max-height:90px; overflow:auto; flex-basis:100%; }
  .grid-wrap { overflow-x:auto; }
  .grid { display:flex; flex-direction:column; gap:14px; }
  .row { display:flex; gap:14px; flex-wrap:wrap; }
  .block { background:#fff; border:1px solid #ddd; border-radius:8px; overflow:hidden; }
  .block h3 { font-size:13px; padding:5px 8px; background:#EEF2FF; color:#3B5BDB; border-bottom:1px solid #ddd; }
  table { border-collapse:collapse; font-size:11px; }
  th, td { border:1px solid #D5D9E2; padding:1px 2px; text-align:center; min-width:50px; height:36px; }
  th { background:#F1F3F7; color:#666; font-weight:600; font-size:10px; }
  td.cls { background:#F8F9FB; font-weight:700; color:#444; min-width:40px; }
  td.cell { cursor:pointer; position:relative; transition:background .15s; }
  td.cell .s { display:block; font-weight:600; font-size:11px; color:#333; }
  td.cell .t { display:block; font-size:8.5px; color:#8A8F99; }
  td.cell.lock { background:#FAFAFA; cursor:not-allowed; }
  td.cell.lock .s { color:#BBB; }
  td.cell.hl { background:var(--hl); }
  td.cell.hl .t { color:#556B4E; font-weight:600; }
  td.cell.vio { outline:2px solid var(--err); outline-offset:-2px; background:#FFEBEE; }
  td.cell.drag-over { background:#FFE8A3 !important; }
  td.cell.drag-src { opacity:.4; }
  td.cell.early { background:#FFF7E6; }
  #violList { margin-top:10px; background:#fff; border:1px solid #E57373; border-radius:8px; padding:10px 14px; display:none; }
  #violList h4 { color:#C62828; font-size:13px; margin-bottom:6px; }
  #violList ul { list-style:none; font-size:12px; color:#555; max-height:280px; overflow:auto; }
  #violList li { padding:3px 0; border-bottom:1px dashed #f0f0f0; }
  #violList li b { color:#C62828; }
  #violList li div { font-size:11px; color:#999; margin:2px 0 0 14px; }
  #toast { position:fixed; top:70px; left:50%; transform:translateX(-50%); background:#C62828; color:#fff;
           padding:10px 22px; border-radius:8px; font-size:13px; z-index:99; display:none; box-shadow:0 4px 12px rgba(0,0,0,.3); }
  .legend { font-size:11px; color:#777; margin-top:8px; }
  .legend span { display:inline-block; width:14px; height:14px; border-radius:3px; vertical-align:-2px; margin:0 4px 0 10px; }
  .tips { font-size:12px; color:#666; line-height:1.7; }
  .tips b { color:#3B5BDB; }
  #pendingList { padding:6px 8px; min-height:120px; max-height:520px; overflow:auto; }
  .p-item { font-size:12px; background:#F8F9FA; border:1px dashed #B9C2D9; border-radius:6px;
            padding:5px 8px; margin:5px 0; cursor:pointer; display:flex; flex-wrap:wrap;
            gap:2px 8px; align-items:center; }
  .p-item:hover { background:#EEF2FF; border-color:#4C6EF5; }
  .p-item .pi-subj { font-weight:700; color:#3B5BDB; }
  .p-item .pi-t { font-size:10px; color:#8A8F99; }
  .p-item .pi-pos { font-size:10px; color:#999; margin-left:auto; }
  .p-empty { font-size:12px; color:#BBB; text-align:center; padding:22px 0; }
  .p-hint { font-size:11px; color:#999; padding:6px 8px 9px; line-height:1.6; border-top:1px dashed #E5E8F0; }

  /* ==== v53 按天换课区 + 两击交换 + 移动端 ==== */
  .day-flex { display:flex; align-items:stretch; flex:1; min-width:0; }
  .tbl-wrap { flex:1; overflow-x:auto; -webkit-overflow-scrolling:touch; min-width:0; }
  .pside { width:110px; flex:none; display:flex; flex-direction:column;
           background:#FBFCFF; border-left:1.5px dashed #AAB4CF; }
  .pside h4 { font-size:11px; font-weight:600; color:#3B5BDB; padding:5px 8px 4px;
              background:#EEF2FF; border-bottom:1px dashed #C9D2EA; white-space:nowrap; }
  .plist { flex:1; overflow-y:auto; padding:4px 6px; }
  .phint { font-size:10px; color:#98A2B3; padding:5px 7px; line-height:1.55;
           border-top:1px dashed #DCE2F0; }
  td.cell.selcell { outline:2.5px solid #4C6EF5; outline-offset:-2.5px; background:#EDF2FF !important; }
  .p-item.selitem { background:#EEF2FF; border-color:#4C6EF5; box-shadow:none; }
  .pi-back { font-size:10px; color:#3B5BDB; border:1px solid #85B7EB; border-radius:4px;
             padding:0 5px; margin-left:4px; cursor:pointer; background:#fff; }
  .pi-back:hover { background:#E6F1FB; }
  #actbar { position:fixed; left:0; right:0; bottom:0; z-index:90; background:#fff;
            border-top:1.5px solid #4C6EF5; padding:10px 14px; display:none;
            align-items:center; gap:10px; box-shadow:0 -2px 10px rgba(0,0,0,.12); }
  #actbar.show { display:flex; }
  #actbar .ab-info { flex:1; font-size:13px; color:#333; min-width:0;
                     overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #actbar button { padding:8px 14px; font-size:13px; flex:none; }
  #abPend   { background:#F59F00; color:#fff; }
  #abBack   { background:#4C6EF5; color:#fff; }
  #abCancel { background:#EEE; color:#555; }
  @media (max-width: 768px) {
    body { padding:6px; }
    h1 { font-size:15px; } .sub { font-size:11px; margin-bottom:6px; }
    .toolbar { padding:7px 8px; gap:6px; }
    .toolbar label { display:none; }
    select { max-width:150px; font-size:12px; }
    button { font-size:12px; padding:7px 12px; }
    .row { flex-direction:column; gap:10px; }
    .block h3 { font-size:12px; }
    th, td { min-width:42px; height:40px; font-size:10px; }
    td.cls { min-width:34px; font-size:10px; }
    td.cell .s { font-size:10px; } td.cell .t { font-size:8px; }
    .pside { width:88px; }
    .tbl-wrap { overflow-x:auto; }
    #toast { top:auto; bottom:70px; max-width:92vw; }
    #violList ul { max-height:200px; }
  }
</style>
</head>
<body>
<h1>__TITLE__</h1>
<div class="sub">__SUBTITLE__</div>

<div class="toolbar">
  <label>教师：</label>
  <select id="selTeacher"><option value="">— 选择老师，其全部课节变绿色 —</option></select>
  <button id="btnCheck">🔍 检查硬约束</button>
  <button id="btnEdit">✏️ 修改</button>
  <span class="stat" id="statBar"></span>
  <span class="badge ok" id="badgeOk">硬约束 ✓ 0 违规</span>
  <div class="summary" id="summary"></div>
</div>

<div id="violList"><h4>⚠️ 硬约束违规清单（红色格子为违规位置）</h4><ul id="violUl"></ul></div>
<div id="toast"></div>
<div id="actbar">
  <span class="ab-info" id="abInfo"></span>
  <button id="abPend">↦ 待选</button>
  <button id="abBack">↺ 回原位</button>
  <button id="abCancel">✕ 取消</button>
</div>

<div class="grid-wrap"><div class="grid" id="grid"></div></div>

<div class="legend">
  <span style="background:#A9BA9D"></span> 选中教师高亮
  <span style="background:#FFF7E6"></span> 早读/夜自习/班会/公共自习（锁定，不可拖）
  <span style="background:#FFEBEE;outline:2px solid #E57373"></span> 硬约束违规
</div>
<div class="tips" style="margin-top:8px">
  <b>使用：</b>① 下拉选教师 → 其所有课节高亮 #A9BA9D，顶部显示该教师周课表；
  ② 点【修改】（变【保存】）→ <b>两击交换</b>：点选一格（蓝框选中），再点另一格即互换/移入空格，误点自己=取消；也可照旧拖拽换位。操作实时校验硬约束，违规拒绝并说明原因；
  ③ 选中的格子底部出操作条 →【↦ 待选】移入当天换课侧栏；<b>点条目</b>→再点任意格落位（不限星期，落在有课的格上=互换），条目 <b>↺</b> 一键回原位；
  ④ 点【保存】退出编辑。早读/夜自习/班会/公共自习格子锁定、不可删除。
</div>

"""
UI_JS_TEMPLATE = r"""// ---------- 状态 ----------
var selTeacher = '', editMode = false, dragSrc = null;
var pend = [[],[],[],[],[]];       // 按天待选篮 pend[d] = [{c,d,s,subj,t}]（放回不限本日）
var selCell = null;                 // 两击交换第一步 {c,d,s}
var selPend = null;                 // 被选中的待选条目 {day,idx}
var _justDragged = false;           // 拖拽刚结束标记，防止误触发点击
var cachedViol = [];                // 最近一次检查的违规（用于放回时的"新增违规"判定）

function clearSel(){
  selCell = null; selPend = null;
  var ab = document.getElementById('actbar'); if(ab) ab.classList.remove('show');
}
function abShow(html){
  document.getElementById('abInfo').innerHTML = html;
  document.getElementById('actbar').classList.add('show');
}

function esc(x){ return String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function sShort(s){ var n = SLOTS[s].name; return n.replace('晚自习1','晚1').replace('晚自习2','晚2').replace('学科自习','自习'); }

// ---------- 渲染 ----------
function render(){
  var grid = document.getElementById('grid');
  grid.innerHTML = '';
  // v53：一天一卡，卡片右侧内嵌当日换课侧栏（与表格等高）；条目放回不限本日
  var layout = [[0,1],[2,3,4]];
  for(var ri=0; ri<layout.length; ri++){
    var rowDiv = document.createElement('div');
    rowDiv.className = 'row';
    for(var bi=0; bi<layout[ri].length; bi++){
      var d = layout[ri][bi];
      var block = document.createElement('div');
      block.className = 'block';
      block.style.flex = '1';
      var h3 = document.createElement('h3');
      h3.textContent = DAYS[d];
      block.appendChild(h3);
      var flex = document.createElement('div');
      flex.className = 'day-flex';
      var wrap = document.createElement('div');
      wrap.className = 'tbl-wrap';
      var tbl = document.createElement('table');
      var thead = '<tr><th>班级</th>';
      for(var s=0;s<13;s++) thead += '<th>'+sShort(s)+'</th>';
      thead += '</tr>';
      var tbody = '';
      for(var ci=0; ci<CLASSES.length; ci++){
        var c = CLASSES[ci];
        tbody += '<tr><td class="cls">'+c+'</td>';
        for(var s=0;s<13;s++){
          var cell = S[c][d][s];
          var locked = isLocked(c,d,s);
          var cls = 'cell' + (locked?' lock':'');
          if(selTeacher && cell.t === selTeacher) cls += ' hl';
          if(selCell && selCell.c===c && selCell.d===d && selCell.s===s) cls += ' selcell';
          tbody += '<td class="'+cls+'" data-c="'+c+'" data-d="'+d+'" data-s="'+s+'" draggable="'+(editMode&&!locked)+'">'
                 + '<span class="s">'+esc(cell.s||'')+'</span>'
                 + '<span class="t">'+esc(cell.t||'')+'</span></td>';
        }
        tbody += '</tr>';
      }
      tbl.innerHTML = thead + tbody;
      wrap.appendChild(tbl);
      flex.appendChild(wrap);
      var aside = document.createElement('div');
      aside.className = 'pside';
      aside.innerHTML = '<h4>换课·'+DAYS[d]+'（<span id="pc'+d+'">'+pend[d].length+'</span>）</h4>'
        + '<div class="plist" id="pl'+d+'"></div>'
        + '<div class="phint">点格子移出至此；<br>点条目后点任意<br>格子落位，↺回原位。<br>不限星期。</div>';
      flex.appendChild(aside);
      block.appendChild(flex);
      rowDiv.appendChild(block);
    }
    grid.appendChild(rowDiv);
  }
  bindCells();
  renderPendingAll();
  updateStats();
}

// ---------- 教师下拉 ----------
function fillTeacherSelect(){
  var sel = document.getElementById('selTeacher');
  var groups = SCHED_DATA.teachers;
  var keys = Object.keys(groups).sort();
  for(var i=0;i<keys.length;i++){
    var subj = keys[i];
    var og = document.createElement('optgroup');
    og.label = subj + '（' + groups[subj].length + '人）';
    for(var j=0;j<groups[subj].length;j++){
      var op = document.createElement('option');
      op.value = groups[subj][j];
      op.textContent = groups[subj][j] + (SCHED_DATA.bzr.indexOf(groups[subj][j])>=0?' ★':'');
      og.appendChild(op);
    }
    sel.appendChild(og);
  }
}

// ---------- 老师高亮 ----------
function onTeacherChange(){
  selTeacher = document.getElementById('selTeacher').value;
  var sum = document.getElementById('summary');
  if(selTeacher){
    var detail = [], total = 0;
    for(var d=0;d<5;d++){
      var lst = [];
      for(var ci=0; ci<CLASSES.length; ci++) for(var s=1;s<12;s++)
        if(S[CLASSES[ci]][d][s].t === selTeacher) lst.push(s);
      if(lst.length){ total += lst.length; detail.push(DAYS[d]+' '+lst.length+'节('+lst.map(sShort).join('、')+')'); }
      else detail.push(DAYS[d]+' 无课');
    }
    sum.style.display = 'block';
    sum.innerHTML = '<b>'+selTeacher+'</b> 本周共 <b>'+total+'</b> 节：' + detail.join('；');
  } else {
    sum.style.display = 'none';
  }
  render();
}

// ---------- 检查展示 ----------
function runCheck(){
  var viol = checkAll();
  var list = document.getElementById('violList');
  var ul = document.getElementById('violUl');
  document.getElementById('badgeOk').textContent = '硬约束 ' + (viol.length?'✗ 违规 '+viol.length+' 处':'✓ 0 违规');
  // 清除旧红框
  document.querySelectorAll('td.cell.vio').forEach(function(td){ td.classList.remove('vio'); });
  if(viol.length){
    list.style.display = 'block';
    ul.innerHTML = '';
    var byName = {};
    for(var i=0;i<viol.length;i++){ var v=viol[i]; (byName[v.name]=byName[v.name]||[]).push(v); }
    for(var name in byName){
      var li = document.createElement('li');
      li.innerHTML = '<b>'+esc(name)+'</b>（'+byName[name].length+'处）';
      var sub = document.createElement('div');
      sub.textContent = byName[name].slice(0,6).map(function(v){return v.msg;}).join('；') + (byName[name].length>6?(' …等'+byName[name].length+'处'):'');
      li.appendChild(sub);
      ul.appendChild(li);
      for(var j=0;j<byName[name].length;j++){
        var v2 = byName[name][j];
        if(v2.cells) for(var k=0;k<v2.cells.length;k++){
          var ck = v2.cells[k];
          var td = document.querySelector('td[data-c="'+ck[0]+'"][data-d="'+ck[1]+'"][data-s="'+ck[2]+'"]');
          if(td) td.classList.add('vio');
        }
      }
    }
  } else {
    list.style.display = 'none';
  }
}
function updateStats(){
  document.getElementById('statBar').textContent =
    (editMode?'✏️ 编辑模式：拖拽格子换位（违规将被拒绝）':'👁 查看模式：选择教师高亮') +
    (selTeacher?' · 高亮: '+selTeacher:'');
}

// ---------- 拖拽换位 ----------
function bindCells(){
  var tds = document.querySelectorAll('td.cell');
  for(var i=0;i<tds.length;i++){
    (function(td){
      td.ondragstart = function(e){
        if(!editMode){ e.preventDefault(); return; }
        var c=td.dataset.c, d=+td.dataset.d, s=+td.dataset.s;
        if(isLocked(c,d,s)){ e.preventDefault(); toast('锁定格不可拖动'); return; }
        dragSrc = {c:c, d:d, s:s};
        clearSel();
        td.classList.add('drag-src');
        e.dataTransfer.effectAllowed = 'move';
      };
      td.ondragend = function(){
        td.classList.remove('drag-src'); dragSrc = null;
        _justDragged = true; setTimeout(function(){ _justDragged = false; }, 150);
      };
      td.ondragover = function(e){ if(editMode&&dragSrc){ e.preventDefault(); td.classList.add('drag-over'); } };
      td.ondragleave = function(){ td.classList.remove('drag-over'); };
      td.ondrop = function(e){
        e.preventDefault();
        td.classList.remove('drag-over');
        _justDragged = true; setTimeout(function(){ _justDragged = false; }, 150);
        if(!editMode||!dragSrc) return;
        var tc=td.dataset.c, td2=+td.dataset.d, ts=+td.dataset.s;
        if(isLocked(tc,td2,ts)){ toast('目标格锁定，不能放入'); dragSrc=null; return; }
        if(dragSrc.c===tc&&dragSrc.d===td2&&dragSrc.s===ts){ dragSrc=null; return; }
        doSwap(dragSrc.c, dragSrc.d, dragSrc.s, tc, td2, ts);
        dragSrc = null;
        render(); runCheck();
      };
      td.onclick = function(){
        if(_justDragged) return;
        if(!editMode){ toast('请先点右上【修改】后再调整课程'); return; }
        var c=td.dataset.c, d=+td.dataset.d, s=+td.dataset.s;
        if(isLocked(c,d,s)){ toast('锁定格不可调整'); clearSel(); render(); return; }
        // —— 优先级1：待选条目已选中 → 本格为落位目标 ——
        if(selPend){
          placePendAt(selPend.day, selPend.idx, c, d, s);
          return;
        }
        // —— 优先级2：两击交换 ——
        if(!selCell){
          var cell = S[c][d][s];
          if(!cell.s){ toast('空格：先从换课区点选一条，再点这里落位'); return; }
          selCell = {c:c, d:d, s:s};
          abShow('<b>已选：</b>'+c+' '+DAYS[d]+sShort(s)+' '+cell.s+(cell.t?'·'+cell.t:'')
               + '&nbsp;<span style="color:#8A8F99">→ 再点另一格互换 / 空格移动</span>');
          document.getElementById('abPend').style.display='';
          document.getElementById('abBack').style.display='none';
          render(); return;
        }
        if(selCell.c===c && selCell.d===d && selCell.s===s){   // 点自己 = 取消（防误触反悔口）
          clearSel(); render(); return;
        }
        var okSwap = doSwap(selCell.c, selCell.d, selCell.s, c, d, s);
        clearSel();
        render(); runCheck();
        if(!okSwap.ok) return;
      };
    })(tds[i]);
  }
}

// 统一交换入口（桌面拖拽/两击共用）
function doSwap(c1,d1,s1,c2,d2,s2){
  var r = trySwap(c1,d1,s1,c2,d2,s2);
  if(r.ok){
    toast('✅ 已对调：'+c1+' '+DAYS[d1]+sShort(s1)+' ↔ '+c2+' '+DAYS[d2]+sShort(s2));
  } else {
    toast('❌ 该移动违反硬约束：'+r.viol[0].name+'（'+r.viol[0].msg+'）');
  }
  return r;
}

// ---------- 待选区（按天分栏，放回不限本日） ----------
function renderPendingAll(){
  for(var d=0; d<5; d++) renderPending(d);
}
function renderPending(day){
  var box = document.getElementById('pl'+day);
  if(!box) return;
  var cnt = document.getElementById('pc'+day);
  if(cnt) cnt.textContent = pend[day].length;
  if(!pend[day].length){
    box.innerHTML = '<div class="p-empty">（空）</div>';
    return;
  }
  var h='';
  for(var i=0;i<pend[day].length;i++){
    var p=pend[day][i];
    var selCls = (selPend && selPend.day===day && selPend.idx===i) ? ' selitem' : '';
    h += '<div class="p-item'+selCls+'" data-day="'+day+'" data-i="'+i+'" title="点选后点课表格子落位">'
       + '<span class="pi-subj">'+esc(p.subj)+'</span>'
       + (p.t?'<span class="pi-t">'+esc(p.t)+'</span>':'')
       + '<span class="pi-pos">'+p.c+'·'+DAYS[p.d]+sShort(p.s)+'</span>'
       + '<button class="pi-back" data-back="1" title="立即回原位">↺</button></div>';
  }
  box.innerHTML = h;
  var items = box.querySelectorAll('.p-item');
  for(var i=0;i<items.length;i++){
    (function(el){
      el.onclick = function(e){
        if(e.target.classList.contains('pi-back')){ e.stopPropagation(); backToOrigin(+el.dataset.day, +el.dataset.i); return; }
        if(!editMode){ toast('请先点【修改】再操作'); return; }
        var day=+el.dataset.day, idx=+el.dataset.i;
        if(selPend && selPend.day===day && selPend.idx===idx){   // 再点同条目 = 取消
          clearSel(); render(); return;
        }
        selCell = null;
        selPend = {day:day, idx:idx};
        var p = pend[day][idx];
        abShow('<b style="color:#F59F00">'+esc(p.subj)+(p.t?'·'+esc(p.t):'')+'</b>（来自 '+p.c+' '+DAYS[p.d]+sShort(p.s)+'）'
             + '&nbsp;<span style="color:#8A8F99">→ 点任意格落位（不限星期），原位若被占可自动另寻空格</span>');
        document.getElementById('abPend').style.display='none';
        document.getElementById('abBack').style.display='';
        render();
      };
    })(items[i]);
  }
}

// 待选条目落到 (c,d,s)：空格=放入；占格=与待选互换（对方课进其天篮子）
function placePendAt(day, idx, c, d, s){
  var p = pend[day][idx];
  if(!p){ clearSel(); render(); return; }
  var cell = S[c][d][s];
  if(isLocked(c,d,s)){ toast('目标格锁定，不能放入'); return; }
  var other = null;
  if(cell.s) other = {c:c, d:d, s:s, subj:cell.s, t:cell.t, lt:cell.lt};   // 目标原课（将进对方天的篮子）
  // 快照当前违规
  var v0 = {};
  for(var i=0;i<cachedViol.length;i++){ var x=cachedViol[i]; v0[x.name+'|'+x.msg]=true; }
  // 写入 p 的课；对方课暂离桌面
  cell.s = p.subj; cell.t = p.t; cell.lt = p.lt || 'L';
  var v2 = checkAll();
  var added = [];
  for(var j=0;j<v2.length;j++){
    var y=v2[j];
    if(v0[y.name+'|'+y.msg]) continue;
    if(String(y.name||'').indexOf('H3')===0) continue;   // H3*=课时缺口类：待选篮非空时的正常缺口，放行
    added.push(y);
  }
  if(added.length){
    cell.s = other ? other.subj : '';      // 还原
    cell.t = other ? other.t : '';
    cell.lt = other ? other.lt : '';
    toast('❌ 落位违反硬约束：'+added[0].name+'（'+added[0].msg+'）');
    render(); return;
  }
  if(other){
    pend[other.d].push(other);             // 对方课进其天的换课区
    toast('✅ 已互换：'+p.subj+(p.t?'·'+p.t:'')+' 落 '+c+' '+DAYS[d]+sShort(s)
        + '；原课 '+other.subj+(other.t?'·'+other.t:'')+' 进 '+DAYS[other.d]+'换课区');
  } else {
    toast('✅ 已放入 '+c+' '+DAYS[d]+sShort(s)+' '+p.subj+(p.t?'·'+p.t:''));
  }
  pend[day].splice(idx,1);
  cachedViol = v2;
  clearSel();
  render(); runCheck();
}

function countMissingCourses(){ var n=0; for(var d=0;d<5;d++) n+=pend[d].length; return n; }

// 回原位（优先原位；被占则自动找当日第一个空格）
function backToOrigin(day, idx){
  if(idx<0 || idx>=pend[day].length) return;
  var p = pend[day][idx];
  var cell = S[p.c][p.d][p.s];
  if(cell.s){
    var found=null, broke=false;
    for(var d=0;d<5&&!broke;d++) for(var ci=0;ci<CLASSES.length&&!broke;ci++){
      var cc=CLASSES[ci];
      for(var s2=1;s2<12;s2++){
        if(isLocked(cc,d,s2)) continue;
        if(!S[cc][d][s2].s){ found={c:cc,d:d,s:s2}; broke=true; break; }
      }
    }
    if(!found){ toast('❌ 原位已被占用，且没有空格可放'); return; }
    S[found.c][found.d][found.s].s = p.subj;
    S[found.c][found.d][found.s].t = p.t;
    S[found.c][found.d][found.s].lt = p.lt || 'L';
    toast('↺ 原位已占，改放到 '+found.c+' '+DAYS[found.d]+sShort(found.s));
  } else {
    cell.s = p.subj; cell.t = p.t; cell.lt = p.lt || 'L';
    toast('↺ 已放回原位：'+p.c+' '+DAYS[p.d]+sShort(p.s));
  }
  pend[day].splice(idx,1);
  clearSel();
  render(); runCheck(); syncCachedViol();
}

function syncCachedViol(){ cachedViol = checkAll(); }

function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.style.display='none'; }, 2800);
}

// ---------- 按钮 ----------
document.getElementById('btnEdit').onclick = function(){
  editMode = !editMode;
  var b = document.getElementById('btnEdit');
  b.textContent = editMode ? '💾 保存' : '✏️ 修改';
  b.className = editMode ? 'on' : '';
  clearSel();                     // v53：退出编辑态必须清空选择/收起操作条（防误触）
  if(!editMode){ render(); return; }
  syncCachedViol();
  render();
  if(pend[0].length+pend[1].length+pend[2].length+pend[3].length+pend[4].length === 0){
    toast('✏️ 编辑中：点课表格子选中 → 再点另一格互换；或用底部【↦ 待选】移出课程');
  }
};
document.getElementById('abPend').onclick = function(){
  if(!editMode || !selCell) return;
  var cell = S[selCell.c][selCell.d][selCell.s];
  if(!cell.s){ clearSel(); render(); return; }
  pend[selCell.d].push({c:selCell.c, d:selCell.d, s:selCell.s, subj:cell.s, t:cell.t, lt:cell.lt});
  toast('🗑 已移入【'+DAYS[selCell.d]+'换课区】：'+cell.s+(cell.t?'·'+cell.t:''));
  cell.s=''; cell.t=''; cell.lt='';
  clearSel();
  render(); runCheck();
};
document.getElementById('abBack').onclick = function(){
  if(selPend) backToOrigin(selPend.day, selPend.idx);
};
document.getElementById('abCancel').onclick = function(){ clearSel(); render(); };
document.getElementById('btnCheck').onclick = runCheck;
document.getElementById('selTeacher').onchange = onTeacherChange;

// ---------- 初始化 ----------
fillTeacherSelect();
render();
runCheck();"""

TEST_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>检查器引擎自动测试</title></head>
<body><pre id="out">running...</pre>
<script>
var SCHED_DATA = __DATA__;
</script>
<script>
__ENGINE__
</script>
<script>
var out = document.getElementById('out');
var lines = [];
function log(s){ lines.push(s); out.textContent = lines.join('\n'); }
function cls(c,d,s){ return S[c][d][s].s+'/'+S[c][d][s].t; }
// T0 初始检查
var v0 = checkAll();
log('T0 初始硬约束检查: ' + (v0.length===0 ? 'PASS (0 违规)' : 'FAIL ('+v0.length+' 违规)'));
if(v0.length) for(var i=0;i<Math.min(v0.length,10);i++) log('    - '+v0[i].name+' | '+v0[i].msg);
// T1 构造教师冲突（CLASSES[1] 同格复制 CLASSES[0] 的教师）→ 应检出
var c0 = CLASSES[0], c1 = CLASSES.length>1 ? CLASSES[1] : CLASSES[0];
var f = null;
outer:
for(var d=0;d<5;d++) for(var s=1;s<12;s++){
  if(S[c0][d][s].t){ f = {d:d, s:s}; break outer; }
}
if(f){
  var saved = S[c1][f.d][f.s];
  S[c1][f.d][f.s] = {s:S[c0][f.d][f.s].s, t:S[c0][f.d][f.s].t, lt:S[c0][f.d][f.s].lt};
  var v1 = checkAll();
  var hasC = v1.some(function(v){ return v.name.indexOf('教师冲突')>=0; });
  log('T1 构造同教师同时段两班: ' + (hasC ? 'PASS (检出冲突)' : 'FAIL (未检出)'));
  S[c1][f.d][f.s] = saved;
  var v1b = checkAll();
  log('    还原后: ' + (v1b.length===0 ? 'PASS (0 违规)' : 'FAIL ('+v1b.length+' 违规)'));
} else {
  log('T1 跳过（无带教师格子）');
}
log('');
log('=== 测试完成 ===');
</script>
</body></html>
"""


def build_single_html(classes, days, slots, sched_data, teacher_list, bzr, title, subtitle, hours=None):
    data_json = json.dumps({
        'classes': classes, 'days': days, 'slots': slots,
        'teachers': teacher_list, 'bzr': bzr, 'data': sched_data,
    }, ensure_ascii=False)
    engine = ENGINE_TEMPLATE
    if hours:
        hours_json = json.dumps({k: list(v) for k, v in hours.items()}, ensure_ascii=False)
        engine = re.sub(r'var SUBJ_HOURS = \{[^}]*\};',
                        'var SUBJ_HOURS = ' + hours_json + ';', engine)
    head = UI_HEAD_TEMPLATE.replace('__TITLE__', title).replace('__SUBTITLE__', subtitle)
    html = (head +
            '<script>\nvar SCHED_DATA = ' + data_json + ';\n</script>\n' +
            '<script>\n' + engine + '\n</script>\n' +
            '<script>\n' + UI_JS_TEMPLATE + '\n</script>\n' +
            '</body>\n</html>\n')
    return html


def main():
    ap = argparse.ArgumentParser(description='课表 → 交互检查器 HTML 生成器')
    ap.add_argument('--schedule', required=True, help='课表 xlsx（每个班级一个 sheet）')
    ap.add_argument('--teachers', default=None,
                    help='教师名单 xlsx（可选；不提供则从课表自动提取教师列表，仅无班主任标记）')
    ap.add_argument('--out', default='.', help='输出目录（默认当前目录）')
    ap.add_argument('--title', default='课表检查器', help='页面标题')
    ap.add_argument('--hours', default=None, help='课时需求 JSON，如 \'{"语文":[5,2],...}\'（默认内置）')
    ap.add_argument('--deploy-dir', default=None,
                    help='部署目录：生成后把 index.html 复制到该目录，供发布网站用')
    ap.add_argument('--verify', action='store_true', help='用 Edge headless 自动验证产物')
    ap.add_argument('--edge', default='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                    help='Edge 可执行文件路径（--verify 时使用）')
    args = ap.parse_args()

    hours = DEFAULT_HOURS
    if args.hours:
        hours = {k: tuple(v) for k, v in json.loads(args.hours).items()}

    os.makedirs(args.out, exist_ok=True)

    print('1) 读取课表...')
    classes, data = load_schedule(args.schedule)
    print(f'   班级 {len(classes)} 个: {classes[:5]}...')

    print('2) 读取教师名单...')
    teacher_info, bzr = load_teachers(args.teachers, classes, data)
    print(f'   教师 {len(teacher_info)} 位' + (f', 班主任 {len(bzr)} 位' if args.teachers else '（从课表自动提取，无班主任标记）'))

    print('3) 判定每格正课位/自习位...')
    lt, unresolved = compute_lt(classes, data, hours)
    if unresolved:
        print(f'   ⚠️ 动态位解析失败(课表槽位不平衡?): {unresolved}')
    else:
        print('   全部班级解析成功 ✓')

    # 组数据
    sched_data = {}
    for c in classes:
        sched_data[c] = []
        for d in range(5):
            day_arr = []
            for s in range(13):
                cell = data[c][d][s]
                day_arr.append({'s': cell['subj'], 't': cell['teacher'], 'lt': lt[(c, d, s)]})
            sched_data[c].append(day_arr)

    teacher_list = {}
    for t, info in teacher_info.items():
        teacher_list.setdefault(info['subj'], []).append(t)
    # 组内排序（自动提取时顺序稳定），按科目排序保证下拉分组整齐
    for subj in teacher_list:
        teacher_list[subj].sort()

    days = ['周一', '周二', '周三', '周四', '周五']
    slots = [{'name': n, 'time': t} for n, t in zip(SLOT_NAMES, SLOT_TIMES)]

    title = args.title
    subtitle = f'{len(classes)} 个班 · 数据来源：{os.path.basename(args.schedule)}'

    print('4) 生成单文件检查器 HTML...')
    html = build_single_html(classes, days, slots, sched_data, teacher_list, bzr, title, subtitle, hours)
    index_path = os.path.join(args.out, 'index.html')
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'   ✓ {index_path} ({len(html)/1024:.0f} KB)')

    if args.deploy_dir:
        os.makedirs(args.deploy_dir, exist_ok=True)
        dep = os.path.join(args.deploy_dir, 'index.html')
        with open(dep, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'   ✓ 部署目录已就绪: {dep}（可用 cloudstudio-deploy 发布此目录）')

    print('5) 生成自动测试页...')
    engine_t = ENGINE_TEMPLATE
    if hours:
        hours_json_t = json.dumps({k: list(v) for k, v in hours.items()}, ensure_ascii=False)
        engine_t = re.sub(r'var SUBJ_HOURS = \{[^}]*\};',
                          'var SUBJ_HOURS = ' + hours_json_t + ';', engine_t)
    test_html = TEST_TEMPLATE.replace('__DATA__', json.dumps({
        'classes': classes, 'days': days, 'slots': slots,
        'teachers': teacher_list, 'bzr': bzr, 'data': sched_data,
    }, ensure_ascii=False)).replace('__ENGINE__', engine_t)
    test_path = os.path.join(args.out, 'test_checker.html')
    with open(test_path, 'w', encoding='utf-8') as f:
        f.write(test_html)
    print(f'   ✓ {test_path}')

    if args.verify:
        print('6) 自动验证（Edge headless）...')
        if not os.path.exists(args.edge):
            print('   ⚠️ 未找到 Edge，跳过验证（可手动打开 test_checker.html）')
            return
        url = 'file://' + os.path.abspath(test_path)
        r = subprocess.run([args.edge, '--headless=new', '--no-sandbox', '--disable-gpu',
                            '--dump-dom', url], capture_output=True, text=True, timeout=120)
        import html as h
        m = re.search(r'<pre id="out">(.*?)</pre>', r.stdout, re.S)
        if m:
            print('   --- 测试输出 ---')
            print(h.unescape(m.group(1)))
            ok = 'T0 初始硬约束检查: PASS' in m.group(1) and 'T1' in m.group(1) and '还原后: PASS' in m.group(1)
            print('   ' + ('✓ 验证通过' if ok else '⚠️ 测试有失败项'))
        else:
            print('   ⚠️ 未能读取测试输出')
    print('完成！')


if __name__ == '__main__':
    main()
