import {encapsulateStyle} from '@angular/compiler';

let css='';
for await(const chunk of process.stdin)css+=chunk;
try{encapsulateStyle(css,'css_probe');process.stdout.write('ok');}
catch(error){process.stderr.write(String(error));process.exitCode=1;}
