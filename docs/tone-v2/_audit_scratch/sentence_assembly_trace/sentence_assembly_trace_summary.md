# sentence_assembly_trace_summary

READ ONLY · no human/semantic judgment

## A. Global counts
```json
{
  "limits": {
    "maxSentenceCandidates": 16,
    "perSpanLimitRule": "<=1→8, ==2→6, else→4",
    "maxIntervalEnumNodes": 1024,
    "maxIntervalRepairPicksPerPath": 16
  },
  "totals": {
    "totalCases": 200,
    "totalPaths": 248,
    "totalBuckets": 321,
    "totalCandidatesTracked": 1432,
    "totalBucketSentences": 550,
    "totalCrossPathSentences": 337,
    "totalKenlmInputs": 337,
    "budgetDropCount": 306,
    "budgetTriggerSpans": 235,
    "bucketDropCount": 492,
    "assemblyEligibleNoSentence": 0
  }
}
```

## B. Candidate fate distribution
```json
{
  "USED_IN_SENTENCE": 792,
  "DROPPED_BUCKET_MISMATCH": 162,
  "USED_IN_MULTIPLE_SENTENCES": 478
}
```

## C. Step drops
- Budget DROP count (candidate instances): 306
- Budget trigger spans: 235
- Bucket DROP annotations: 492
- A1 (budget-kept, no sentence): 0

## D. Multi Path cases
count=30
- {"caseId":"d001","pathCount":2,"sentencesPerPath":[{"pathId":"dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36","n":2},{"pathId":"34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03","n":2}]}
- {"caseId":"d019","pathCount":2,"sentencesPerPath":[{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","n":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","n":8}]}
- {"caseId":"d020","pathCount":2,"sentencesPerPath":[{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","n":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","n":2}]}
- {"caseId":"d021","pathCount":2,"sentencesPerPath":[{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","n":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","n":1}]}
- {"caseId":"d043","pathCount":2,"sentencesPerPath":[{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","n":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","n":2}]}
- {"caseId":"d044","pathCount":4,"sentencesPerPath":[{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","n":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","n":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","n":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","n":4}]}
- {"caseId":"d045","pathCount":4,"sentencesPerPath":[{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","n":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","n":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","n":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","n":4}]}
- {"caseId":"d046","pathCount":4,"sentencesPerPath":[{"pathId":"dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1","n":2},{"pathId":"704f98b82a57f8aa19f954c6a5b2d95560dbc90e65e43a6e72fc56256c16c5ab","n":1},{"pathId":"f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d","n":2},{"pathId":"b381ed15660cc47935a5acdc3d6802646a22eae9a515096a636b6002db634b39","n":1}]}
- {"caseId":"d064","pathCount":2,"sentencesPerPath":[{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","n":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","n":8}]}
- {"caseId":"d065","pathCount":2,"sentencesPerPath":[{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","n":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","n":2}]}
- {"caseId":"d066","pathCount":2,"sentencesPerPath":[{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","n":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","n":1}]}
- {"caseId":"d088","pathCount":2,"sentencesPerPath":[{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","n":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","n":2}]}
- {"caseId":"d089","pathCount":4,"sentencesPerPath":[{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","n":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","n":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","n":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","n":4}]}
- {"caseId":"d090","pathCount":4,"sentencesPerPath":[{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","n":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","n":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","n":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","n":4}]}
- {"caseId":"d109","pathCount":2,"sentencesPerPath":[{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","n":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","n":8}]}
- {"caseId":"d110","pathCount":2,"sentencesPerPath":[{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","n":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","n":2}]}
- {"caseId":"d111","pathCount":2,"sentencesPerPath":[{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","n":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","n":1}]}
- {"caseId":"d133","pathCount":2,"sentencesPerPath":[{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","n":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","n":2}]}
- {"caseId":"d134","pathCount":4,"sentencesPerPath":[{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","n":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","n":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","n":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","n":4}]}
- {"caseId":"d135","pathCount":4,"sentencesPerPath":[{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","n":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","n":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","n":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","n":4}]}
- {"caseId":"d154","pathCount":2,"sentencesPerPath":[{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","n":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","n":8}]}
- {"caseId":"d155","pathCount":2,"sentencesPerPath":[{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","n":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","n":2}]}
- {"caseId":"d156","pathCount":2,"sentencesPerPath":[{"pathId":"a4c0876153861a0089493877032bd3ee43b5520178506c0cdfc830637f46a8ea","n":1},{"pathId":"53fa80de77688323aeb8193f42739986f77dbdf76c39a3718b63b712cb31c9ed","n":1}]}
- {"caseId":"d178","pathCount":2,"sentencesPerPath":[{"pathId":"86bbdea09331c4feb5a8c0ad9881f21444a7ba7ae866222c8b4c24b3fba4ce42","n":2},{"pathId":"eefbde0a8d0d9a4bd706030008aee9a3ba8aef276637bb189b65c4365acf56c9","n":2}]}
- {"caseId":"d179","pathCount":4,"sentencesPerPath":[{"pathId":"3a7c0ec19c68211cdf24335825c8d37e4aa2134e2fc89f2e63c8e4317cc94389","n":2},{"pathId":"066ebc94f339a351afffd32d14f7e56193e4b7aea663b15d787ffdc5993bda0f","n":2},{"pathId":"57ea9b89e4fc35be95b82fbc831b7f5c4c7f6f5fe37c7010697f3f088ac465f6","n":2},{"pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","n":4}]}
- {"caseId":"d180","pathCount":4,"sentencesPerPath":[{"pathId":"80d8d072c93bd03cae9cbb84c08e94e3da22d362211a19bb4e9529d389cfcbd9","n":4},{"pathId":"93e4109d85b5380fab48f556415ccbc466756d447402b61852516ce4b9af9d96","n":4},{"pathId":"2ad765c2b868ddad2f2aacc904cdbbff13b3bd2676190675e265773ee4a9a6ab","n":4},{"pathId":"65aa4e3a49b767d4a16d0bb386a6f55fc3d2885c77f30fc1f8e5824bd3aebf0a","n":4}]}
- {"caseId":"d181","pathCount":2,"sentencesPerPath":[{"pathId":"dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36","n":2},{"pathId":"34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03","n":2}]}
- {"caseId":"d182","pathCount":2,"sentencesPerPath":[{"pathId":"c46ccc49340f7cb86275e5e6630d22b5e936024be72283698eb14d6f44e7284c","n":1},{"pathId":"3710d2726d9b83a417e0491e8b96ed9f4eff0bc90b7e7a7b91f4e68d31556789","n":1}]}
- {"caseId":"d199","pathCount":2,"sentencesPerPath":[{"pathId":"e25d32df4a2f13ce5216a81f5af51374a302cd1168c3e874a1547bedd89fd0b8","n":8},{"pathId":"982f3f240464b76e9444a459acaf33ee860bc86f3827f03a9ecc863f3bb62ddb","n":8}]}
- {"caseId":"d200","pathCount":2,"sentencesPerPath":[{"pathId":"d18e38f8936e3dae9107ea8e2acaf78da3b2472127b9644ea2be67380e9844d7","n":2},{"pathId":"d0727a8e1c03785b04ed2877ce853d0488af5bbfebedbe740226ff2cb15c2120","n":2}]}

## E. Multi Bucket cases
count=52
- {"caseId":"d001","pathId":"dfdf9f0cedb03c87e0d1f43c670ec66222f45ae24de8fb942124a8ed4d139e36","buckets":[{"domain":"food_order","sentences":1},{"domain":"coffee","sentences":1}]}
- {"caseId":"d001","pathId":"34555bf4cfbd5917bf1089256ee6a3ad60e9757d24216598cdf06ef883136d03","buckets":[{"domain":"coffee","sentences":1},{"domain":"food_order","sentences":1}]}
- {"caseId":"d006","pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","buckets":[{"domain":"food_order","sentences":1},{"domain":"meeting","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d007","pathId":"ce61e4f57b177b95d39665e0aa77ec09fca042ee22c72a2f8e6f99c0e9df5c87","buckets":[{"domain":"tourism_hotel","sentences":2},{"domain":"tourism_transport","sentences":1}]}
- {"caseId":"d012","pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","buckets":[{"domain":"coffee","sentences":1},{"domain":"food_order","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d023","pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","buckets":[{"domain":"coffee","sentences":2},{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1},{"domain":"tourism_route","sentences":2}]}
- {"caseId":"d024","pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","buckets":[{"domain":"food_order","sentences":1},{"domain":"tourism_hotel","sentences":1}]}
- {"caseId":"d026","pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","buckets":[{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d035","pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","buckets":[{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d036","pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","buckets":[{"domain":"tech_ai","sentences":1},{"domain":"tourism_pickup","sentences":2}]}
- {"caseId":"d041","pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","buckets":[{"domain":"medical","sentences":2},{"domain":"meeting","sentences":2},{"domain":"tourism_hotel","sentences":1}]}
- {"caseId":"d044","pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","buckets":[{"domain":"tech_ai","sentences":2},{"domain":"tourism_hotel","sentences":2}]}
- {"caseId":"d046","pathId":"dd88f4c1999c8c4a6dc2a146d96c228be385aecd3ea8f0fe1fd2abf72a4966b1","buckets":[{"domain":"coffee","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d046","pathId":"f25c790ab3feecb08234a9eb9296f94b017f8b895a73a294adf352766678e47d","buckets":[{"domain":"coffee","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d051","pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","buckets":[{"domain":"food_order","sentences":1},{"domain":"meeting","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d053","pathId":"d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57","buckets":[{"domain":"meeting","sentences":2},{"domain":"tourism_pickup","sentences":2}]}
- {"caseId":"d054","pathId":"ab4e09381d1743d1b906dc96cb06dfa63703940f9d50a6e270ce20b4e312fe26","buckets":[{"domain":"medical","sentences":2},{"domain":"milk_tea","sentences":2}]}
- {"caseId":"d057","pathId":"b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea","buckets":[{"domain":"medical","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d068","pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","buckets":[{"domain":"coffee","sentences":2},{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1},{"domain":"tourism_route","sentences":2}]}
- {"caseId":"d069","pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","buckets":[{"domain":"food_order","sentences":1},{"domain":"tourism_hotel","sentences":1}]}
- {"caseId":"d071","pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","buckets":[{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d080","pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","buckets":[{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d081","pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","buckets":[{"domain":"tech_ai","sentences":1},{"domain":"tourism_pickup","sentences":2}]}
- {"caseId":"d086","pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","buckets":[{"domain":"medical","sentences":2},{"domain":"meeting","sentences":2},{"domain":"tourism_hotel","sentences":1}]}
- {"caseId":"d089","pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","buckets":[{"domain":"tech_ai","sentences":2},{"domain":"tourism_hotel","sentences":2}]}
- {"caseId":"d096","pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","buckets":[{"domain":"food_order","sentences":1},{"domain":"meeting","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d102","pathId":"fa8f5c186469a544f504e2b1180e1f88870a9ded26eff5007a876fd7ef34e55d","buckets":[{"domain":"coffee","sentences":1},{"domain":"food_order","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d113","pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","buckets":[{"domain":"coffee","sentences":2},{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1},{"domain":"tourism_route","sentences":2}]}
- {"caseId":"d114","pathId":"b40add9c18b994f3214720b91c9e39c1ec9a08acd66742f9b51723c5d1d357f6","buckets":[{"domain":"food_order","sentences":1},{"domain":"tourism_hotel","sentences":1}]}
- {"caseId":"d116","pathId":"b12f3cf0aef86ec71cf7ca92007b4ed2b271c07b66773e2211895464537dd8e6","buckets":[{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d125","pathId":"2913b934f41b6799cf1415142f4c210ceef85a8cc8572ca4ea9a0734a8e0e55b","buckets":[{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d126","pathId":"6bcff49b0914307d218e0a1eff428d5f84a8e0578634047e841739527dddedbb","buckets":[{"domain":"tech_ai","sentences":1},{"domain":"tourism_pickup","sentences":2}]}
- {"caseId":"d131","pathId":"3b518d0b2df5f529d68743f21657b328629df6e85a64c6f34b152211b6dc2f06","buckets":[{"domain":"medical","sentences":2},{"domain":"meeting","sentences":2},{"domain":"tourism_hotel","sentences":1}]}
- {"caseId":"d134","pathId":"1e01ba7584d9e3d132a29bce455c9f9262f69591509b4623fd5d51aae06b8008","buckets":[{"domain":"tech_ai","sentences":2},{"domain":"tourism_hotel","sentences":2}]}
- {"caseId":"d136","pathId":"a06b4c93a167bb6f741e0d2b7f2fa3cf1de1c31c7397ed5152e88b59922cac69","buckets":[{"domain":"coffee","sentences":1},{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1}]}
- {"caseId":"d141","pathId":"54a9f07e03af142eb5a06f0dd3e6a30fb09f82b47cd652dc08d575fdfc606551","buckets":[{"domain":"food_order","sentences":1},{"domain":"meeting","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d143","pathId":"d9e028c3cf0bd38c6f8f20b22181fa312da5899e1b990b73516f687aa58fee57","buckets":[{"domain":"meeting","sentences":2},{"domain":"tourism_pickup","sentences":2}]}
- {"caseId":"d144","pathId":"517d47c6bc06be41b48765ec4ea593f519ea0fbd8378a2d99469ff2a464751e6","buckets":[{"domain":"medical","sentences":2},{"domain":"milk_tea","sentences":2}]}
- {"caseId":"d147","pathId":"b6dd9bf159bd6f37accf48512c1d3b164dd9bdb60d1a18d5053e700f027ebaea","buckets":[{"domain":"medical","sentences":1},{"domain":"tech_ai","sentences":1}]}
- {"caseId":"d158","pathId":"3827924af8b5fc1e5dcc9c033f608a7c7a11790e401302ab152418017fcb5359","buckets":[{"domain":"coffee","sentences":2},{"domain":"food_order","sentences":1},{"domain":"milk_tea","sentences":1},{"domain":"tourism_route","sentences":2}]}
- ... 12 more

## I. KenLM input provenance
{"traced":337,"untraced":0,"textMismatch":0}

## J. Anomaly inventory A1–A20
- A1: 0
- A2: 0
- A3: 0
- A4: 0
- A5: 0
- A6: 0
- A7: 0
- A8: 0
- A9: 0
- A10: 0
- A11: 0
- A12: 0
- A13: 0
- A14: 0
- A15: 0
- A16: 0
- A17: 0
- A18: 0
- A19: 166
  - {"caseId":"d001","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d002","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d003","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d004","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d005","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d006","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d007","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d009","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d010","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d011","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d012","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d013","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d014","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d015","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - {"caseId":"d019","note":"PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface","owner":"window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick"}
  - ... 151 more
- A20: 0
