# Candidate Pool Review

Triggered 31/43; dual=15; triple=5; prefilled>1=0

## A01
- text: 请确认地址
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"地址","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 请确认地址

## A02
- text: 请确认客户地址
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"地址","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 请确认客户地址

## A03
- text: 新的地址已经更新
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"2:4","syllableStart":2,"syllableEnd":4,"text":"地址","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 新的地址已经更新

## A04
- text: 请确认医院
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"医院","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 请确认医院

## A05
- text: 去医院确认一下
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"1:3","syllableStart":1,"syllableEnd":3,"text":"医院","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 去医院确认一下

## A06
- text: 医院就在附近
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"医院","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 医院就在附近

## A07
- text: 请确认医师
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 请确认医师

## A08
- text: 需要一位医师
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"4:6","syllableStart":4,"syllableEnd":6,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 需要一位医师

## A09
- text: 医师已经到了
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 医师已经到了

## A10
- text: 地质结构需要检查
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"地质","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 地质结构需要检查

## A11
- text: 我要一杯低脂牛奶
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"4:6","syllableStart":4,"syllableEnd":6,"text":"低脂","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 我要一杯低脂牛奶

## A12
- text: 议员出席会议
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"议员","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 议员出席会议

## B01
- text: 请确认地址和医院
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"6:8","syllableStart":6,"syllableEnd":8,"text":"医院","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 请确认地址和医院

## B02
- text: 请确认地址和医师
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"6:8","syllableStart":6,"syllableEnd":8,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 请确认地址和医师

## B03
- text: 请确认医院和医师
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"6:8","syllableStart":6,"syllableEnd":8,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 请确认医院和医师

## B04
- text: 客户地址和医院都要
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"2:4","syllableStart":2,"syllableEnd":4,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"医院","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 客户地址和医院都要

## B05
- text: 新地址靠近医院
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"1:3","syllableStart":1,"syllableEnd":3,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"医院","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 新地址靠近医院

## B06
- text: 请把地址发给医师
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"2:4","syllableStart":2,"syllableEnd":4,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"6:8","syllableStart":6,"syllableEnd":8,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 请把地址发给医师

## B07
- text: 医院地址请确认
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"2:4","syllableStart":2,"syllableEnd":4,"text":"地址","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 医院地址请确认

## B08
- text: 医师确认了地址
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"医师","surfaces":["医师","议室"],"identityCount":3},{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"地址","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 医师确认了地址

## B09
- text: 医院和医师都已到位
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 医院和医师都已到位

## B10
- text: 请核对地址、医院信息
- expectedCombos(prescan)=4 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"医院","surfaces":["医院","议员"],"identityCount":3}]
- prefilled texts:
  - 请核对地址、医院信息

## C01
- text: 请确认地址、医院和医师
- expectedCombos(prescan)=8 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"8:10","syllableStart":8,"syllableEnd":10,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 请确认地址、医院和医师

## C02
- text: 地址医院医师请一并确认
- expectedCombos(prescan)=8 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"2:4","syllableStart":2,"syllableEnd":4,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"4:6","syllableStart":4,"syllableEnd":6,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 地址医院医师请一并确认

## C03
- text: 请把地址发给医院的医师
- expectedCombos(prescan)=8 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"2:4","syllableStart":2,"syllableEnd":4,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"6:8","syllableStart":6,"syllableEnd":8,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"9:11","syllableStart":9,"syllableEnd":11,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 请把地址发给医院的医师

## C04
- text: 医师在医院核对地址
- expectedCombos(prescan)=8 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"0:2","syllableStart":0,"syllableEnd":2,"text":"医师","surfaces":["医师","议室"],"identityCount":3},{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"7:9","syllableStart":7,"syllableEnd":9,"text":"地址","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 医师在医院核对地址

## C05
- text: 请确认医院地址和医师安排
- expectedCombos(prescan)=8 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"3:5","syllableStart":3,"syllableEnd":5,"text":"医院","surfaces":["医院","议员"],"identityCount":3},{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"地址","surfaces":["低脂","地质"],"identityCount":2},{"windowId":"8:10","syllableStart":8,"syllableEnd":10,"text":"医师","surfaces":["医师","议室"],"identityCount":3}]
- prefilled texts:
  - 请确认医院地址和医师安排

## D01
- text: 请确认少糖去冰大杯
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 请确认少糖去冰大杯

## D02
- text: 我想堂食还是带走
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 我想堂食还是带走

## D03
- text: 前台正在确认预订
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 前台正在确认预订

## D04
- text: 大杯和小杯都要重新下单
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 大杯和小杯都要重新下单

## D05
- text: 请确认菜单和打包
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 请确认菜单和打包

## E01
- text: 请确认上线计划
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 请确认上线计划

## E02
- text: 请检查接口文档
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 请检查接口文档

## E03
- text: 帮我修改预订信息
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 帮我修改预订信息

## E04
- text: 大杯拿铁已经下单
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 大杯拿铁已经下单

## E05
- text: 请确认房间预订
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 请确认房间预订

## F01
- text: 请确认新的地址
- expectedCombos(prescan)=2 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=BUCKET
- eligible spans: [{"windowId":"5:7","syllableStart":5,"syllableEnd":7,"text":"地址","surfaces":["低脂","地质"],"identityCount":2}]
- prefilled texts:
  - 请确认新的地址

## F02
- text: 我想预订一个房间
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 我想预订一个房间

## F03
- text: 帮我准备一杯大杯拿铁
- expectedCombos(prescan)=0 theoretical(bucket)=1 distinctAsm=1 prefilled=1 collapse=RECALL
- eligible spans: []
- prefilled texts:
  - 帮我准备一杯大杯拿铁

